/**
 * Mock settlement adapter.
 *
 * A complete, in-memory payment rail: it honours idempotency, can settle
 * synchronously or asynchronously, can be made to fail, verifies webhook
 * signatures, and supports refunds. It exists so the clearing engine can be
 * exercised end to end without a provider account — and so every real adapter
 * has a reference implementation of the contract.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  RefundRequest,
  RefundResult,
  SettlementAdapter,
  SettlementRequest,
  SettlementResult,
  SettlementState,
  SettlementStatus,
  SettlementWebhookEvent,
} from "@mayarin/settlement";
import {
  type Clock,
  generateId,
  NotFoundError,
  ProviderError,
  systemClock,
  ValidationError,
} from "@mayarin/shared";

/** How a settle() call resolves. */
export type MockBehaviour =
  /** Settles immediately. */
  | "succeed"
  /** Accepts the settlement and leaves it pending until a webhook or `complete()`. */
  | "pending"
  /** Rejects the settlement. */
  | "fail";

export interface MockSettlementAdapterOptions {
  readonly name?: string;
  readonly clock?: Clock;
  readonly behaviour?: MockBehaviour;
  /** Shared secret for webhook signature verification. Unset disables checking. */
  readonly webhookSecret?: string;
  readonly failureReason?: string;
}

interface MockSettlement {
  providerReference: string;
  clearingTransactionId: string;
  state: SettlementState;
  amount: SettlementRequest["amount"];
  updatedAt: Date;
  failureReason?: string;
}

export const MOCK_SIGNATURE_HEADER = "x-mayarin-signature";

export class MockSettlementAdapter implements SettlementAdapter {
  readonly name: string;
  readonly #clock: Clock;
  readonly #settlements = new Map<string, MockSettlement>();
  /** idempotency key -> provider reference, so a replayed settle is not a second payout. */
  readonly #byIdempotencyKey = new Map<string, string>();
  readonly #behaviour: MockBehaviour;
  readonly #webhookSecret: string | undefined;
  readonly #failureReason: string;

  constructor(options: MockSettlementAdapterOptions = {}) {
    this.name = options.name ?? "mock";
    this.#clock = options.clock ?? systemClock;
    this.#behaviour = options.behaviour ?? "succeed";
    this.#webhookSecret = options.webhookSecret;
    this.#failureReason = options.failureReason ?? "Mock adapter configured to fail";
  }

  async settle(request: SettlementRequest): Promise<SettlementResult> {
    const existingReference = this.#byIdempotencyKey.get(request.idempotencyKey);
    if (existingReference !== undefined) {
      return toResult(this.#require(existingReference));
    }

    if (this.#behaviour === "fail") {
      // A declined payout, not a transient outage: retrying it unchanged would
      // be declined again, so the clearing engine should fail the payment.
      throw new ProviderError(
        this.#failureReason,
        { provider: this.name, clearingTransactionId: request.clearingTransactionId },
        { retryable: false },
      );
    }

    const now = this.#clock.now();
    const settlement: MockSettlement = {
      providerReference: generateId("stl", now.getTime()),
      clearingTransactionId: request.clearingTransactionId,
      state: this.#behaviour === "succeed" ? "SUCCEEDED" : "PENDING",
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
      ...(settlement.failureReason === undefined
        ? {}
        : { failureReason: settlement.failureReason }),
    };
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    const settlement = this.#require(request.providerReference);
    if (settlement.state !== "SUCCEEDED") {
      throw new ProviderError(
        `Settlement ${settlement.providerReference} is ${settlement.state} and cannot be refunded`,
        { provider: this.name, state: settlement.state },
        { retryable: false },
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

  async webhook(context: {
    headers: Readonly<Record<string, string>>;
    rawBody: string;
  }): Promise<SettlementWebhookEvent | null> {
    this.#verifySignature(context);

    let body: unknown;
    try {
      body = JSON.parse(context.rawBody);
    } catch (error) {
      throw new ValidationError(
        "Webhook body is not valid JSON",
        { provider: this.name },
        {
          cause: error,
        },
      );
    }

    const payload = body as {
      providerReference?: unknown;
      state?: unknown;
      failureReason?: unknown;
      occurredAt?: unknown;
    };

    if (typeof payload.providerReference !== "string" || typeof payload.state !== "string") {
      throw new ValidationError("Webhook body must carry providerReference and state", {
        provider: this.name,
      });
    }

    const settlement = this.#settlements.get(payload.providerReference);
    // Unknown references are acknowledged, not rejected: replays and events for
    // other environments must not fail the provider's delivery.
    if (settlement === undefined) return null;

    const state = payload.state as SettlementState;
    settlement.state = state;
    settlement.updatedAt =
      typeof payload.occurredAt === "string" ? new Date(payload.occurredAt) : this.#clock.now();
    if (typeof payload.failureReason === "string") settlement.failureReason = payload.failureReason;

    return {
      providerReference: settlement.providerReference,
      clearingTransactionId: settlement.clearingTransactionId,
      state,
      occurredAt: settlement.updatedAt,
      ...(settlement.failureReason === undefined
        ? {}
        : { failureReason: settlement.failureReason }),
      raw: body,
    };
  }

  // --- Test controls -------------------------------------------------------

  /** Drives a pending settlement to a terminal state, as a real rail eventually would. */
  complete(providerReference: string, state: SettlementState = "SUCCEEDED"): void {
    const settlement = this.#require(providerReference);
    settlement.state = state;
    settlement.updatedAt = this.#clock.now();
  }

  /** Signs a webhook body the way this adapter expects to receive it. */
  sign(rawBody: string): string {
    if (this.#webhookSecret === undefined) {
      throw new ValidationError("Mock adapter has no webhook secret configured");
    }
    return createHmac("sha256", this.#webhookSecret).update(rawBody).digest("hex");
  }

  #require(providerReference: string): MockSettlement {
    const settlement = this.#settlements.get(providerReference);
    if (settlement === undefined) {
      throw new NotFoundError(`Unknown settlement ${providerReference}`, {
        provider: this.name,
        providerReference,
      });
    }
    return settlement;
  }

  #verifySignature(context: { headers: Readonly<Record<string, string>>; rawBody: string }): void {
    if (this.#webhookSecret === undefined) return;

    const provided = context.headers[MOCK_SIGNATURE_HEADER];
    if (provided === undefined) {
      throw new ValidationError(`Webhook is missing the ${MOCK_SIGNATURE_HEADER} header`, {
        provider: this.name,
      });
    }

    const expected = this.sign(context.rawBody);
    const providedBytes = Buffer.from(provided, "utf8");
    const expectedBytes = Buffer.from(expected, "utf8");

    if (
      providedBytes.length !== expectedBytes.length ||
      !timingSafeEqual(providedBytes, expectedBytes)
    ) {
      throw new ValidationError("Webhook signature does not match", { provider: this.name });
    }
  }
}

function toResult(settlement: MockSettlement): SettlementResult {
  return {
    providerReference: settlement.providerReference,
    state: settlement.state,
    ...(settlement.state === "SUCCEEDED" ? { settledAt: settlement.updatedAt } : {}),
    ...(settlement.failureReason === undefined ? {} : { failureReason: settlement.failureReason }),
  };
}
