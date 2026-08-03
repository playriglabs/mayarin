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
}

interface InternalSettlement {
  readonly providerReference: string;
  readonly clearingTransactionId: string;
  state: SettlementState;
  readonly amount: SettlementRequest["amount"];
  updatedAt: Date;
}

export class StablecoinSettlementAdapter implements SettlementAdapter {
  readonly name: string;
  readonly mode = "internal" as const;
  readonly #clock: Clock;
  readonly #settlements = new Map<string, InternalSettlement>();
  /** idempotency key -> provider reference, so a replayed settle is not a second credit. */
  readonly #byIdempotencyKey = new Map<string, string>();

  constructor(options: StablecoinSettlementAdapterOptions = {}) {
    this.name = options.name ?? "stablecoin";
    this.#clock = options.clock ?? systemClock;
  }

  async settle(request: SettlementRequest): Promise<SettlementResult> {
    const existingReference = this.#byIdempotencyKey.get(request.idempotencyKey);
    if (existingReference !== undefined) {
      return toResult(this.#require(existingReference));
    }

    const now = this.#clock.now();
    const settlement: InternalSettlement = {
      providerReference: generateId("stl", now.getTime()),
      clearingTransactionId: request.clearingTransactionId,
      state: "SUCCEEDED",
      amount: request.amount,
      updatedAt: now,
    };

    this.#settlements.set(settlement.providerReference, settlement);
    this.#byIdempotencyKey.set(request.idempotencyKey, settlement.providerReference);
    return toResult(settlement);
  }

  async status(providerReference: string): Promise<SettlementStatus> {
    const settlement = this.#require(providerReference);
    return {
      providerReference: settlement.providerReference,
      state: settlement.state,
      amount: settlement.amount,
      updatedAt: settlement.updatedAt,
    };
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    const settlement = this.#require(request.providerReference);
    if (settlement.state !== "SUCCEEDED") {
      throw new NotFoundError(
        `Settlement ${settlement.providerReference} is ${settlement.state} and cannot be refunded`,
        { provider: this.name, providerReference: settlement.providerReference },
      );
    }

    settlement.state = "REFUNDED";
    settlement.updatedAt = this.#clock.now();

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

  #require(providerReference: string): InternalSettlement {
    const settlement = this.#settlements.get(providerReference);
    if (settlement === undefined) {
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
