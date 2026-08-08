/**
 * Refund application service.
 *
 * Its own service rather than a method on `ClearingEngine`: the engine drives a
 * payment forward through nine states, and a refund is not one of them. It runs
 * after the machine has finished, against a transaction the engine will never
 * touch again.
 *
 * What it will not do is as important as what it will. A refund moves value out
 * of wherever the merchant was paid. On the **internal settlement path** that is
 * a balance Mayarin holds, so it is ours to move. On the **on-chain contract
 * path** the merchant was paid into their own wallet and Mayarin holds no key
 * to it — so a refund there is refused rather than faked. That is #11's
 * dependency showing through, and pretending otherwise would mean an API that
 * reports a refund nobody sent.
 */

import type { LedgerService } from "@mayarin/ledger";
import type { SettlementAdapterRegistry } from "@mayarin/settlement";
import {
  type Clock,
  ConflictError,
  type EventPublisher,
  type Money,
  NotFoundError,
  noopEventPublisher,
  ValidationError,
} from "@mayarin/shared";
import { refundPosting } from "./postings.ts";
import {
  assertRefundable,
  createRefund,
  markRefundFailed,
  markRefundSucceeded,
  type Refund,
  type RefundSummary,
  summariseRefunds,
} from "./refund.ts";
import type { ClearingRepository } from "./repository.ts";
import type { ClearingTransaction } from "./types.ts";

/** Persistence port for refunds. Implemented outside core, like every other. */
export interface RefundRepository {
  insert(refund: Refund): Promise<void>;
  update(refund: Refund): Promise<void>;
  findById(id: string): Promise<Refund | null>;
  findByIdempotencyKey(key: string): Promise<Refund | null>;
  listByClearingTransactionId(clearingTransactionId: string): Promise<readonly Refund[]>;
}

export const REFUND_EVENT = {
  created: "refund.created",
  succeeded: "refund.succeeded",
  failed: "refund.failed",
} as const;

export interface RefundServiceOptions {
  readonly clearing: ClearingRepository;
  readonly refunds: RefundRepository;
  readonly adapters: SettlementAdapterRegistry;
  readonly ledger: LedgerService;
  readonly clock: Clock;
  readonly events?: EventPublisher;
}

export interface IssueRefundCommand {
  readonly clearingTransactionId: string;
  /** Omitted refunds everything still refundable. */
  readonly amount?: Money;
  readonly reason?: string;
  readonly idempotencyKey?: string;
}

export class RefundService {
  readonly #clearing: ClearingRepository;
  readonly #refunds: RefundRepository;
  readonly #adapters: SettlementAdapterRegistry;
  readonly #ledger: LedgerService;
  readonly #clock: Clock;
  readonly #events: EventPublisher;

  constructor(options: RefundServiceOptions) {
    this.#clearing = options.clearing;
    this.#refunds = options.refunds;
    this.#adapters = options.adapters;
    this.#ledger = options.ledger;
    this.#clock = options.clock;
    this.#events = options.events ?? noopEventPublisher;
  }

  async summary(clearingTransactionId: string): Promise<RefundSummary> {
    const transaction = await this.#transaction(clearingTransactionId);
    const net = requireNet(transaction);
    return summariseRefunds(net, await this.#refunds.listByClearingTransactionId(transaction.id));
  }

  async list(clearingTransactionId: string): Promise<readonly Refund[]> {
    return this.#refunds.listByClearingTransactionId(clearingTransactionId);
  }

  /**
   * Issues a refund.
   *
   * Order matters and is the same discipline the clearing engine uses: the
   * refund row is written **before** the rail is called, so a crash in between
   * leaves a `PENDING` refund that still consumes the refundable balance. The
   * alternative — call first, record after — loses the record of money that
   * left, which is the one failure that cannot be reconciled afterwards.
   */
  async issue(command: IssueRefundCommand): Promise<Refund> {
    if (command.idempotencyKey !== undefined) {
      const existing = await this.#refunds.findByIdempotencyKey(command.idempotencyKey);
      // A replay returns what it made. Amount is not re-checked: the caller is
      // asking for the same refund, and answering with a conflict would make a
      // retried request look like a new mistake.
      if (existing !== null) return existing;
    }

    const transaction = await this.#transaction(command.clearingTransactionId);
    assertRefundablePath(transaction);

    if (transaction.state !== "SUCCESS") {
      throw new ConflictError(
        `Payment ${transaction.paymentIntentId} has not settled and cannot be refunded`,
        { id: transaction.id, state: transaction.state },
      );
    }

    const net = requireNet(transaction);
    const summary = summariseRefunds(
      net,
      await this.#refunds.listByClearingTransactionId(transaction.id),
    );

    const amount = command.amount ?? summary.remaining;
    assertRefundable(summary, amount);

    const refund = createRefund({
      clearingTransactionId: transaction.id,
      paymentIntentId: transaction.paymentIntentId,
      merchantId: transaction.merchant.id,
      amount,
      ...(command.reason === undefined ? {} : { reason: command.reason }),
      ...(command.idempotencyKey === undefined ? {} : { idempotencyKey: command.idempotencyKey }),
      now: this.#clock.now(),
    });

    await this.#refunds.insert(refund);
    await this.#publish(REFUND_EVENT.created, refund);

    return this.#execute(transaction, refund);
  }

  async #execute(transaction: ClearingTransaction, refund: Refund): Promise<Refund> {
    const providerReference = transaction.providerReference;
    if (providerReference === undefined) {
      return this.#fail(refund, "The settlement has no provider reference to refund against");
    }

    try {
      const adapter = this.#adapters.get(transaction.provider);
      const result = await adapter.refund({
        providerReference,
        // The refund's own id: a retried execution of the same refund must not
        // issue a second one at the rail.
        idempotencyKey: refund.id,
        amount: refund.amount,
        ...(refund.reason === undefined ? {} : { reason: refund.reason }),
      });

      // Posted after the rail confirms, so the ledger never records value
      // leaving that never left. The posting is idempotent on the refund id, so
      // a retry cannot double-post.
      await this.#ledger.post(refundPosting(transaction, refund.id, refund.amount));

      const succeeded = markRefundSucceeded(refund, result.refundReference, this.#clock.now());
      await this.#refunds.update(succeeded);
      await this.#publish(REFUND_EVENT.succeeded, succeeded);
      return succeeded;
    } catch (error) {
      return this.#fail(refund, error instanceof Error ? error.message : "Refund failed");
    }
  }

  async #fail(refund: Refund, reason: string): Promise<Refund> {
    const failed = markRefundFailed(refund, reason, this.#clock.now());
    await this.#refunds.update(failed);
    await this.#publish(REFUND_EVENT.failed, failed);
    return failed;
  }

  async #transaction(id: string): Promise<ClearingTransaction> {
    const transaction = await this.#clearing.findById(id);
    if (transaction === null) {
      throw new NotFoundError(`Clearing transaction ${id} not found`, { id });
    }
    return transaction;
  }

  async #publish(type: string, refund: Refund): Promise<void> {
    await this.#events.publish([
      {
        id: `${refund.id}:${type}`,
        type,
        aggregateId: refund.clearingTransactionId,
        occurredAt: refund.updatedAt,
        payload: {
          refundId: refund.id,
          clearingTransactionId: refund.clearingTransactionId,
          paymentIntentId: refund.paymentIntentId,
          amount: refund.amount.amount.toString(),
          asset: refund.amount.asset,
          state: refund.state,
        },
      },
    ]);
  }
}

/**
 * Refuses a refund Mayarin cannot actually send.
 *
 * The contract path pays the merchant's own wallet directly — that is the point
 * of it, and it is why the merchant is self-custodial from the moment of
 * payment. It also means nothing here holds a key that could send the money
 * back. Until #11 gives a refund a signer, this is a refusal, not a gap to
 * paper over.
 */
function assertRefundablePath(transaction: ClearingTransaction): void {
  if (transaction.executionPath === "on-chain-contract") {
    throw new ValidationError(
      "A contract-path payment settled directly to the merchant's own wallet; Mayarin holds no key to refund it (see #11)",
      { id: transaction.id, executionPath: transaction.executionPath },
    );
  }
}

function requireNet(transaction: ClearingTransaction): Money {
  const net = transaction.netAmount;
  if (net === undefined) {
    throw new ConflictError(`Clearing transaction ${transaction.id} has no settled amount`, {
      id: transaction.id,
      state: transaction.state,
    });
  }
  return net;
}
