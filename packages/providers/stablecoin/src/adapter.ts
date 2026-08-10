/**
 * Stablecoin settlement adapter.
 *
 * The internal rail: settling a payment here credits the merchant a stablecoin
 * balance Mayarin holds on their behalf — a ledger liability the clearing engine
 * posts at the SETTLED step. The adapter itself holds no ledger and signs
 * nothing; it records the settlement idempotently and reports SUCCEEDED
 * synchronously, because an internal ledger credit is deterministic. A real
 * on-chain payout to the merchant's wallet is Phase 4 and uses the same
 * `SettlementAdapter` port with `mode: "external"`.
 */

import type {
  RefundRequest,
  RefundResult,
  SettlementAdapter,
  SettlementRequest,
  SettlementResult,
  SettlementState,
  SettlementStatus,
  SettlementWebhookEvent,
  WebhookContext,
} from "@mayarin/settlement";
import { type Clock, generateId, NotFoundError, systemClock } from "@mayarin/shared";

export interface StablecoinSettlementAdapterOptions {
  readonly name?: string;
  readonly clock?: Clock;
  /**
   * Where settled records live. Defaults to memory, which is right for a test
   * and wrong for a deployment: a restart between settling and the engine's
   * status probe loses the reference, and the payment fails with "unknown
   * settlement" after its money has already moved.
   */
  readonly store?: InternalSettlementStore;
}

export interface InternalSettlement {
  readonly providerReference: string;
  readonly clearingTransactionId: string;
  state: SettlementState;
  readonly amount: SettlementRequest["amount"];
  updatedAt: Date;
}

/**
 * Where the internal rail keeps what it settled.
 *
 * A port rather than a `Map` because this record has to outlive the process.
 * The engine settles, persists `providerReference`, and then asks this adapter
 * what became of it — possibly after a restart. Held in memory, that second
 * question answered "unknown settlement" and failed a payment whose money had
 * already moved. The clearing transaction was durable; its counterparty was not.
 */
export interface InternalSettlementStore {
  put(settlement: InternalSettlement, idempotencyKey: string): Promise<void>;
  find(providerReference: string): Promise<InternalSettlement | null>;
  findByIdempotencyKey(key: string): Promise<InternalSettlement | null>;
  setState(providerReference: string, state: SettlementState, at: Date): Promise<void>;
}

/** The reference store: correct, and forgets everything when the process ends. */
export class InMemorySettlementStore implements InternalSettlementStore {
  readonly #byReference = new Map<string, InternalSettlement>();
  readonly #byIdempotencyKey = new Map<string, string>();

  async put(settlement: InternalSettlement, idempotencyKey: string): Promise<void> {
    this.#byReference.set(settlement.providerReference, settlement);
    this.#byIdempotencyKey.set(idempotencyKey, settlement.providerReference);
  }

  async find(providerReference: string): Promise<InternalSettlement | null> {
    return this.#byReference.get(providerReference) ?? null;
  }

  async findByIdempotencyKey(key: string): Promise<InternalSettlement | null> {
    const reference = this.#byIdempotencyKey.get(key);
    return reference === undefined ? null : this.find(reference);
  }

  async setState(providerReference: string, state: SettlementState, at: Date): Promise<void> {
    const settlement = this.#byReference.get(providerReference);
    if (settlement === undefined) return;
    settlement.state = state;
    settlement.updatedAt = at;
  }
}

export class StablecoinSettlementAdapter implements SettlementAdapter {
  readonly name: string;
  readonly mode = "internal" as const;
  readonly #clock: Clock;
  readonly #store: InternalSettlementStore;

  constructor(options: StablecoinSettlementAdapterOptions = {}) {
    this.name = options.name ?? "stablecoin";
    this.#clock = options.clock ?? systemClock;
    this.#store = options.store ?? new InMemorySettlementStore();
  }

  async settle(request: SettlementRequest): Promise<SettlementResult> {
    const existing = await this.#store.findByIdempotencyKey(request.idempotencyKey);
    if (existing !== null) return toResult(existing);

    const now = this.#clock.now();
    const settlement: InternalSettlement = {
      providerReference: generateId("stl", now.getTime()),
      clearingTransactionId: request.clearingTransactionId,
      state: "SUCCEEDED",
      amount: request.amount,
      updatedAt: now,
    };

    await this.#store.put(settlement, request.idempotencyKey);
    return toResult(settlement);
  }

  async status(providerReference: string): Promise<SettlementStatus> {
    const settlement = await this.#require(providerReference);
    return {
      providerReference: settlement.providerReference,
      state: settlement.state,
      amount: settlement.amount,
      updatedAt: settlement.updatedAt,
    };
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    const settlement = await this.#require(request.providerReference);
    if (settlement.state !== "SUCCEEDED") {
      throw new NotFoundError(
        `Settlement ${settlement.providerReference} is ${settlement.state} and cannot be refunded`,
        { provider: this.name, providerReference: settlement.providerReference },
      );
    }

    settlement.state = "REFUNDED";
    settlement.updatedAt = this.#clock.now();
    await this.#store.setState(settlement.providerReference, "REFUNDED", settlement.updatedAt);

    return {
      providerReference: settlement.providerReference,
      refundReference: generateId("stl", settlement.updatedAt.getTime()),
      state: settlement.state,
    };
  }

  async webhook(_context: WebhookContext): Promise<SettlementWebhookEvent | null> {
    // An internal rail has no external provider to emit events; the settlement
    // is synchronous, so there is nothing for a webhook to report.
    return null;
  }

  async #require(providerReference: string): Promise<InternalSettlement> {
    const settlement = await this.#store.find(providerReference);
    if (settlement === null) {
      throw new NotFoundError(`Unknown settlement ${providerReference}`, {
        provider: this.name,
        providerReference,
      });
    }
    return settlement;
  }
}

function toResult(settlement: InternalSettlement): SettlementResult {
  return {
    providerReference: settlement.providerReference,
    state: settlement.state,
    ...(settlement.state === "SUCCEEDED" ? { settledAt: settlement.updatedAt } : {}),
  };
}
