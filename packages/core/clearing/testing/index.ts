/**
 * Reference in-memory fake for the clearing repository, shipped in a segregated
 * `/testing` subpath so domain `src/` stays pure.
 *
 * State changes and their events are stored together, as the Postgres
 * implementation writes them in one database transaction.
 */

import {
  type AssetCode,
  ConcurrencyError,
  ConfigurationError,
  ConflictError,
} from "@mayarin/shared";
import type {
  ClearingEvent,
  ClearingRepository,
  ClearingTransaction,
  ContractLock,
  ContractLockRequest,
  ContractOrder,
  ContractPaymentPlanner,
  ContractRenewRequest,
  OraclePrice,
  PriceOracle,
  Refund,
  RefundRepository,
} from "../src/index.ts";
import { isTerminalState, rateKey } from "../src/index.ts";

/**
 * Reference in-memory contract planner (#61): serves a configured lock — or
 * derives one per request — and records each request, so an engine test can
 * assert what reached the planner without the quote/execution stack.
 *
 * `renew` re-signs with the new deadline and a visibly different signature, so
 * a test can tell the renewed order from the locked one. An optional callback
 * replaces the default for failure scripting.
 */
export class FakeContractPlanner implements ContractPaymentPlanner {
  readonly calls: ContractLockRequest[] = [];
  readonly renewCalls: ContractRenewRequest[] = [];
  readonly #lock: ContractLock | ((request: ContractLockRequest) => ContractLock);
  readonly #renew: ((request: ContractRenewRequest) => ContractOrder) | undefined;

  constructor(
    lock: ContractLock | ((request: ContractLockRequest) => ContractLock),
    renew?: (request: ContractRenewRequest) => ContractOrder,
  ) {
    this.#lock = lock;
    this.#renew = renew;
  }

  async lock(request: ContractLockRequest): Promise<ContractLock> {
    this.calls.push(request);
    return typeof this.#lock === "function" ? this.#lock(request) : this.#lock;
  }

  async renew(request: ContractRenewRequest): Promise<ContractOrder> {
    this.renewCalls.push(request);
    if (this.#renew !== undefined) return this.#renew(request);
    return {
      ...request.order,
      deadline: BigInt(request.expiresAt.getTime()) / 1_000n,
      signature: `0x${"cd".repeat(65)}`,
    };
  }
}

/**
 * Reference in-memory oracle: serves the configured observations verbatim.
 * Freshness is the caller's judgement (the guard takes `now`), so a test can
 * hand this oracle an old `observedAt` to exercise staleness.
 */
export class FixedPriceOracle implements PriceOracle {
  readonly #prices: ReadonlyMap<string, OraclePrice>;

  constructor(prices: readonly OraclePrice[]) {
    this.#prices = new Map(prices.map((price) => [rateKey(price.from, price.to), price]));
  }

  async reference(from: AssetCode, to: AssetCode): Promise<OraclePrice> {
    const price = this.#prices.get(rateKey(from, to));
    if (price === undefined) {
      throw new ConfigurationError(`No reference price for ${from} -> ${to}`, { from, to });
    }
    return price;
  }
}

export class InMemoryClearingRepository implements ClearingRepository {
  readonly #byId = new Map<string, ClearingTransaction>();
  readonly #byPaymentIntentId = new Map<string, string>();
  readonly #events = new Map<string, ClearingEvent[]>();

  async insert(transaction: ClearingTransaction, events: readonly ClearingEvent[]): Promise<void> {
    if (this.#byId.has(transaction.id)) {
      throw new ConflictError(`Clearing transaction ${transaction.id} already exists`, {
        id: transaction.id,
      });
    }
    if (this.#byPaymentIntentId.has(transaction.paymentIntentId)) {
      throw new ConflictError(
        `Payment intent ${transaction.paymentIntentId} is already being cleared`,
        { paymentIntentId: transaction.paymentIntentId },
      );
    }

    this.#byId.set(transaction.id, transaction);
    this.#byPaymentIntentId.set(transaction.paymentIntentId, transaction.id);
    this.#events.set(transaction.id, [...events]);
  }

  async update(
    transaction: ClearingTransaction,
    expectedVersion: number,
    events: readonly ClearingEvent[],
  ): Promise<void> {
    const current = this.#byId.get(transaction.id);
    if (current === undefined) {
      throw new ConflictError(`Clearing transaction ${transaction.id} does not exist`, {
        id: transaction.id,
      });
    }
    if (current.version !== expectedVersion) {
      throw new ConcurrencyError(
        `Clearing transaction ${transaction.id} was modified concurrently`,
        {
          id: transaction.id,
          expectedVersion,
          actualVersion: current.version,
        },
      );
    }

    this.#byId.set(transaction.id, transaction);
    this.#events.get(transaction.id)?.push(...events);
  }

  async findById(id: string): Promise<ClearingTransaction | null> {
    return this.#byId.get(id) ?? null;
  }

  async findByPaymentIntentId(paymentIntentId: string): Promise<ClearingTransaction | null> {
    const id = this.#byPaymentIntentId.get(paymentIntentId);
    return id === undefined ? null : (this.#byId.get(id) ?? null);
  }

  async listByPaymentIntentIds(
    paymentIntentIds: readonly string[],
  ): Promise<readonly ClearingTransaction[]> {
    const found: ClearingTransaction[] = [];
    for (const paymentIntentId of paymentIntentIds) {
      const id = this.#byPaymentIntentId.get(paymentIntentId);
      const transaction = id === undefined ? undefined : this.#byId.get(id);
      if (transaction !== undefined) found.push(transaction);
    }
    return found;
  }

  async findByContractIntentId(intentId: string): Promise<ClearingTransaction | null> {
    for (const transaction of this.#byId.values()) {
      if (transaction.contract?.order.intentId === intentId) return transaction;
    }
    return null;
  }

  async findByProviderReference(
    provider: string,
    providerReference: string,
  ): Promise<ClearingTransaction | null> {
    for (const transaction of this.#byId.values()) {
      if (
        transaction.provider === provider &&
        transaction.providerReference === providerReference
      ) {
        return transaction;
      }
    }
    return null;
  }

  async listEvents(clearingTransactionId: string): Promise<ClearingEvent[]> {
    return [...(this.#events.get(clearingTransactionId) ?? [])].sort(
      (a, b) => a.sequence - b.sequence,
    );
  }

  async listResumable(limit: number): Promise<ClearingTransaction[]> {
    return [...this.#byId.values()]
      .filter((transaction) => !isTerminalState(transaction.state))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit);
  }

  async listPendingPayerSurplusRefunds(limit: number): Promise<ClearingTransaction[]> {
    return [...this.#byId.values()]
      .filter((transaction) => {
        if (transaction.state !== "SUCCESS") return false;
        const events = this.#events.get(transaction.id) ?? [];
        const refundable = events.some(
          (event) =>
            (event.payload as { payerSurplusDisposition?: unknown }).payerSurplusDisposition ===
            "refundable",
        );
        const confirmed = events.some((event) => event.type === "payer-surplus.refund.confirmed");
        return refundable && !confirmed;
      })
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit);
  }
}

/**
 * Reference in-memory refund repository (#12).
 *
 * Mirrors the Postgres adapter's unique idempotency key, so a test exercises
 * the same replay behaviour without a database.
 */
export class InMemoryRefundRepository implements RefundRepository {
  readonly #byId = new Map<string, Refund>();
  readonly #tails = new Map<string, Promise<unknown>>();

  async serialize<T>(clearingTransactionId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(clearingTransactionId) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    this.#tails.set(
      clearingTransactionId,
      next.catch(() => undefined),
    );
    return next;
  }

  readonly #byIdempotencyKey = new Map<string, string>();

  async insert(refund: Refund): Promise<void> {
    if (this.#byId.has(refund.id)) {
      throw new ConflictError(`Refund ${refund.id} already exists`, { id: refund.id });
    }
    if (refund.idempotencyKey !== undefined) {
      if (this.#byIdempotencyKey.has(refund.idempotencyKey)) {
        throw new ConflictError(`Idempotency key "${refund.idempotencyKey}" is already in use`, {
          idempotencyKey: refund.idempotencyKey,
        });
      }
      this.#byIdempotencyKey.set(refund.idempotencyKey, refund.id);
    }
    this.#byId.set(refund.id, refund);
  }

  async update(refund: Refund): Promise<void> {
    this.#byId.set(refund.id, refund);
  }

  async findById(id: string): Promise<Refund | null> {
    return this.#byId.get(id) ?? null;
  }

  async listCreatedSince(since: Date): Promise<readonly Refund[]> {
    return [...this.#byId.values()]
      .filter((refund) => refund.createdAt >= since)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async listPendingBefore(before: Date): Promise<readonly Refund[]> {
    return [...this.#byId.values()].filter(
      (refund) => refund.state === "PENDING" && refund.updatedAt < before,
    );
  }

  async findByIdempotencyKey(key: string): Promise<Refund | null> {
    const id = this.#byIdempotencyKey.get(key);
    return id === undefined ? null : (this.#byId.get(id) ?? null);
  }

  async listByClearingTransactionId(clearingTransactionId: string): Promise<readonly Refund[]> {
    return [...this.#byId.values()]
      .filter((refund) => refund.clearingTransactionId === clearingTransactionId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
}
