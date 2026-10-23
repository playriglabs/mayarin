/**
 * Returning a failed deposit to the payer.
 *
 * A deposit-match payment can fail after the payer's asset arrived and before
 * it went anywhere: the order could not be renewed, the swap never met `minOut`.
 * The asset then sits at the deposit address, owed back, and the ledger keeps
 * `PAYER_ASSET_HELD` open against it.
 *
 * Money moves only to an address the payer named on the rail. The sender of the
 * deposit is not used: an exchange withdrawal comes from an omnibus wallet
 * where a refund is credited to nobody. A payer who named no address is left
 * for a person, and says so.
 *
 * Every send is guarded three ways:
 *
 * - the router must not have consumed the order's intent, so a payment that did
 *   settle is never also returned;
 * - `deposit.return.started` is written before the transfer, so a crash between
 *   the transfer and its record cannot make a later pass send a second one;
 * - the ledger is cleared only after the transfer is read back as successful.
 *
 * A failed payment waits `graceSeconds` first, so a person can still retry it.
 */

import type { ChainId } from "@mayarin/chain";
import type { LedgerService } from "@mayarin/ledger";
import type { PaymentIntent } from "@mayarin/payment-intent";
import { generateId, type Money, serializeMoney } from "@mayarin/shared";
import { depositReturnedPosting, sweepGasPosting } from "./postings.ts";
import type { ClearingRepository } from "./repository.ts";
import type { SweepResult } from "./treasury.ts";
import type {
  ClearingDeposit,
  ClearingEvent,
  ClearingEventType,
  ClearingTransaction,
} from "./types.ts";

export interface DepositReturnRequest {
  readonly clearingTransactionId: string;
  readonly chain: ChainId;
  readonly depositAddress: string;
  /** The signed order's intent id, which the router records once it has paid. */
  readonly intentId: string;
  /** What the ledger holds for the payer, which is exactly what goes back. */
  readonly amount: Money;
  readonly to: string;
}

export type DepositReturnReceipt =
  | { readonly status: "pending" }
  | { readonly status: "reverted" }
  | { readonly status: "success"; readonly gasCost?: Money };

/** The sender of a deposit when it is safe to return to, otherwise why it is not. */
export type SenderLookup = { readonly address: string } | { readonly refused: string };

/** The only seam that moves a failed deposit; it holds the operator key. */
export interface DepositReturnPort {
  supports(chain: ChainId): boolean;
  /**
   * Everything that can be checked and undone before value moves: the router
   * has not consumed the intent, `to` is not one of Mayarin's own addresses,
   * the deposit is swept to the operator and the operator holds the amount.
   * Throws when any of that fails.
   */
  prepare(request: DepositReturnRequest): Promise<SweepResult | undefined>;
  /**
   * The address a deposit came from, when that address can be trusted to belong to
   * the payer: it sent the transfer itself, is an ordinary account rather than a
   * contract, and is not a wallet that moves volume like an exchange's. Absent on a
   * port that cannot tell, which leaves a payer who named no address for a person.
   */
  senderOf?(request: Omit<DepositReturnRequest, "to" | "intentId">): Promise<SenderLookup>;
  /** Broadcasts the transfer and returns its hash without waiting for it. */
  send(request: DepositReturnRequest): Promise<string>;
  receipt(chain: ChainId, txHash: string): Promise<DepositReturnReceipt>;
}

export type DepositReturnOutcome =
  | "returned"
  | "pending"
  | "no-address"
  /** `started` was written and no `broadcast` followed: a send may have happened. */
  | "needs-review"
  | "reverted"
  | "error";

export interface DepositReturnProgress {
  readonly transaction: ClearingTransaction;
  readonly outcome: DepositReturnOutcome;
  readonly detail?: string;
}

export interface DepositReturnServiceOptions {
  readonly repository: ClearingRepository;
  readonly intents: { getById(id: string): Promise<PaymentIntent> };
  readonly ledger: LedgerService;
  readonly port: DepositReturnPort;
  readonly clock: { now(): Date };
  /** How long a failed payment stays retryable before its deposit is sent back. */
  readonly graceSeconds: number;
  /**
   * Returns to the deposit's sender when the payer named no address. Off unless
   * given: a sender is a guess about who the payer is, so it is only used for a
   * payment priced at or below `maxSettlement` (minor units of its settlement
   * asset), which bounds what a wrong guess can cost.
   */
  readonly returnToSender?: { readonly maxSettlement: bigint };
}

export class DepositReturnService {
  readonly #options: DepositReturnServiceOptions;
  /** Why a payment's sender was refused, so a refusal costs one lookup per process rather than one a minute. */
  readonly #refusals = new Map<string, string>();

  constructor(options: DepositReturnServiceOptions) {
    this.#options = options;
  }

  async returnPending(limit = 50): Promise<DepositReturnProgress[]> {
    const { repository, port, clock, graceSeconds } = this.#options;
    const failedBefore = new Date(clock.now().getTime() - graceSeconds * 1_000);
    const candidates = await repository.listPendingDepositReturns(failedBefore, limit);

    const results: DepositReturnProgress[] = [];
    for (const transaction of candidates) {
      if (transaction.deposit === undefined || !port.supports(transaction.deposit.chain)) continue;
      try {
        results.push(await this.#return(transaction));
      } catch (error) {
        // One payment that cannot move must not stop the others.
        const detail = error instanceof Error ? error.message : String(error);
        results.push({ transaction, outcome: "error", detail });
      }
    }
    return results;
  }

  async #return(start: ClearingTransaction): Promise<DepositReturnProgress> {
    const { repository, intents, ledger, port } = this.#options;
    const deposit = start.deposit;
    const order = start.contract?.order;
    if (deposit === undefined || order === undefined) {
      return { transaction: start, outcome: "error", detail: "no deposit or signed order" };
    }

    const events = await repository.listEvents(start.id);
    const broadcast = events.findLast((event) => event.type === "deposit.return.broadcast");
    let transaction = start;
    let txHash = broadcast === undefined ? undefined : referenceOf(broadcast);

    if (txHash === undefined) {
      if (events.some((event) => event.type === "deposit.return.started")) {
        return {
          transaction,
          outcome: "needs-review",
          detail: "a return was started and no transfer was recorded; check the operator wallet",
        };
      }
      const declared = (await intents.getById(start.paymentIntentId)).payment?.returnAddress;
      const target =
        declared !== undefined
          ? { to: declared, source: "declared" }
          : await this.#senderFor(start, deposit);
      if ("refused" in target) {
        return {
          transaction,
          outcome: "no-address",
          ...(target.refused === "" ? {} : { detail: target.refused }),
        };
      }
      const { to, source } = target;

      const request: DepositReturnRequest = {
        clearingTransactionId: start.id,
        chain: deposit.chain,
        depositAddress: deposit.address,
        intentId: order.intentId,
        amount: deposit.amount,
        to,
      };
      const sweep = await port.prepare(request);
      if (sweep?.gasCost !== undefined) {
        await ledger.post(sweepGasPosting(start, sweep.gasCost, sweep.txHash));
      }
      transaction = await this.#record(transaction, "deposit.return.started", { to, source });
      txHash = await port.send(request);
      transaction = await this.#record(transaction, "deposit.return.broadcast", {
        providerReference: txHash,
        to,
        source,
      });
    }

    const receipt = await port.receipt(deposit.chain, txHash);
    if (receipt.status === "pending") return { transaction, outcome: "pending" };
    if (receipt.status === "reverted") {
      return { transaction, outcome: "reverted", detail: `return ${txHash} reverted` };
    }

    if (receipt.gasCost !== undefined) {
      await ledger.post(sweepGasPosting(start, receipt.gasCost, txHash));
    }
    await ledger.post(depositReturnedPosting(start));
    transaction = await this.#record(transaction, "deposit.return.confirmed", {
      providerReference: txHash,
    });
    return { transaction, outcome: "returned" };
  }

  /** The deposit's sender, when the payer named no address and returning to the sender is on and safe. */
  async #senderFor(
    transaction: ClearingTransaction,
    deposit: ClearingDeposit,
  ): Promise<{ to: string; source: string } | { refused: string }> {
    const { port, returnToSender } = this.#options;
    // Not an event: a payer who named no address and a deployment that returns only to
    // named ones is the ordinary case, and it has nothing to say.
    if (returnToSender === undefined || port.senderOf === undefined) return { refused: "" };

    const earlier = this.#refusals.get(transaction.id);
    if (earlier !== undefined) return { refused: earlier };

    const limit = returnToSender.maxSettlement;
    const priced = transaction.settlementAmount?.amount;
    const refuse = (reason: string) => {
      this.#refusals.set(transaction.id, reason);
      return { refused: reason };
    };
    if (priced === undefined || priced > limit) {
      return refuse("the payment is above the limit for returning to the sender");
    }

    const found = await port.senderOf({
      clearingTransactionId: transaction.id,
      chain: deposit.chain,
      depositAddress: deposit.address,
      amount: deposit.amount,
    });
    return "refused" in found ? refuse(found.refused) : { to: found.address, source: "sender" };
  }

  async #record(
    transaction: ClearingTransaction,
    type: ClearingEventType,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<ClearingTransaction> {
    const now = this.#options.clock.now();
    const next: ClearingTransaction = {
      ...transaction,
      updatedAt: now,
      version: transaction.version + 1,
    };
    const event: ClearingEvent = {
      id: generateId("evt", now.getTime()),
      clearingTransactionId: transaction.id,
      sequence: next.version,
      type,
      toState: transaction.state,
      payload: {
        ...payload,
        ...(transaction.deposit === undefined
          ? {}
          : { amount: serializeMoney(transaction.deposit.amount) }),
      },
      occurredAt: now,
    };
    await this.#options.repository.update(next, transaction.version, [event]);
    return next;
  }
}

function referenceOf(event: ClearingEvent): string | undefined {
  const reference = (event.payload as { providerReference?: unknown }).providerReference;
  return typeof reference === "string" ? reference : undefined;
}
