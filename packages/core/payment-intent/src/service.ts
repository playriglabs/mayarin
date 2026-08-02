/**
 * Payment intent application service.
 *
 * Owns the intent aggregate: creation (idempotent), expiry, and the lifecycle
 * transitions the clearing engine drives. It never talks to a settlement
 * provider — that is the clearing engine's job.
 */

import { createHash } from "node:crypto";
import {
  type AssetCode,
  type Clock,
  type EventPublisher,
  IdempotencyConflictError,
  type Money,
  NotFoundError,
  noopEventPublisher,
  serializeMoney,
} from "@mayarr/shared";
import { PAYMENT_INTENT_EVENT, type PaymentIntentEventType, paymentIntentEvent } from "./events.ts";
import {
  confirm as confirmIntent,
  createPaymentIntent,
  isExpired,
  markCompleted as markIntentCompleted,
  markExpired as markIntentExpired,
  markFailed as markIntentFailed,
  markProcessing as markIntentProcessing,
} from "./intent.ts";
import type { PaymentIntentRepository } from "./repository.ts";
import type { MerchantSnapshot, PaymentIntent, PaymentSource } from "./types.ts";

export interface CreatePaymentIntentCommand {
  readonly merchant: MerchantSnapshot;
  readonly amount: Money;
  readonly source: PaymentSource;
  readonly settlementAsset?: AssetCode;
  readonly provider?: string;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly idempotencyKey?: string;
  readonly ttlSeconds?: number;
}

export interface PaymentIntentServiceOptions {
  readonly repository: PaymentIntentRepository;
  readonly clock: Clock;
  readonly events?: EventPublisher;
  readonly defaults: {
    readonly settlementAsset: AssetCode;
    readonly provider: string;
    readonly ttlSeconds: number;
  };
}

export class PaymentIntentService {
  readonly #repository: PaymentIntentRepository;
  readonly #clock: Clock;
  readonly #events: EventPublisher;
  readonly #defaults: PaymentIntentServiceOptions["defaults"];

  constructor(options: PaymentIntentServiceOptions) {
    this.#repository = options.repository;
    this.#clock = options.clock;
    this.#events = options.events ?? noopEventPublisher;
    this.#defaults = options.defaults;
  }

  /**
   * Creates an intent.
   *
   * With an idempotency key, replaying the same request returns the original
   * intent; reusing the key for different parameters is rejected rather than
   * quietly returning something the caller did not ask for.
   */
  async create(command: CreatePaymentIntentCommand): Promise<PaymentIntent> {
    const settlementAsset = command.settlementAsset ?? this.#defaults.settlementAsset;
    const provider = command.provider ?? this.#defaults.provider;
    const fingerprint = fingerprintOf({ ...command, settlementAsset, provider });

    if (command.idempotencyKey !== undefined) {
      const existing = await this.#repository.findByIdempotencyKey(command.idempotencyKey);
      if (existing !== null) {
        if (existing.requestFingerprint !== fingerprint) {
          throw new IdempotencyConflictError(
            `Idempotency key "${command.idempotencyKey}" was already used with different parameters`,
            { idempotencyKey: command.idempotencyKey, existingIntentId: existing.id },
          );
        }
        return existing;
      }
    }

    const intent = createPaymentIntent({
      merchant: command.merchant,
      amount: command.amount,
      settlementAsset,
      provider,
      source: command.source,
      ...(command.metadata === undefined ? {} : { metadata: command.metadata }),
      ...(command.idempotencyKey === undefined ? {} : { idempotencyKey: command.idempotencyKey }),
      requestFingerprint: fingerprint,
      ttlSeconds: command.ttlSeconds ?? this.#defaults.ttlSeconds,
      now: this.#clock.now(),
    });

    await this.#repository.insert(intent);
    await this.#events.publish([paymentIntentEvent(PAYMENT_INTENT_EVENT.created, intent)]);
    return intent;
  }

  /** Loads an intent, settling any due expiry first so reads never report stale state. */
  async getById(id: string): Promise<PaymentIntent> {
    const intent = await this.#repository.findById(id);
    if (intent === null) {
      throw new NotFoundError(`Payment intent ${id} not found`, { id });
    }
    return this.expireIfDue(intent);
  }

  async expireIfDue(intent: PaymentIntent): Promise<PaymentIntent> {
    const now = this.#clock.now();
    if (!isExpired(intent, now)) return intent;
    return this.#apply(
      markIntentExpired(intent, now),
      intent.version,
      PAYMENT_INTENT_EVENT.expired,
    );
  }

  async confirm(id: string): Promise<PaymentIntent> {
    const intent = await this.getById(id);
    // Confirming an intent that is already past CREATED is a safe replay — a
    // retried request must not fail a payment that is already under way.
    // Expired and failed intents still refuse, via the transition table.
    if (
      intent.status === "CONFIRMED" ||
      intent.status === "PROCESSING" ||
      intent.status === "COMPLETED"
    ) {
      return intent;
    }
    return this.#apply(
      confirmIntent(intent, this.#clock.now()),
      intent.version,
      PAYMENT_INTENT_EVENT.confirmed,
    );
  }

  async markProcessing(
    intent: PaymentIntent,
    clearingTransactionId: string,
  ): Promise<PaymentIntent> {
    if (intent.status === "PROCESSING") return intent;
    return this.#apply(
      markIntentProcessing(intent, clearingTransactionId, this.#clock.now()),
      intent.version,
      PAYMENT_INTENT_EVENT.processing,
    );
  }

  async markCompleted(intent: PaymentIntent): Promise<PaymentIntent> {
    if (intent.status === "COMPLETED") return intent;
    return this.#apply(
      markIntentCompleted(intent, this.#clock.now()),
      intent.version,
      PAYMENT_INTENT_EVENT.completed,
    );
  }

  async markFailed(intent: PaymentIntent, reason: string): Promise<PaymentIntent> {
    if (intent.status === "FAILED") return intent;
    return this.#apply(
      markIntentFailed(intent, reason, this.#clock.now()),
      intent.version,
      PAYMENT_INTENT_EVENT.failed,
    );
  }

  async #apply(
    next: PaymentIntent,
    expectedVersion: number,
    eventType: PaymentIntentEventType,
  ): Promise<PaymentIntent> {
    await this.#repository.update(next, expectedVersion);
    await this.#events.publish([paymentIntentEvent(eventType, next)]);
    return next;
  }
}

/**
 * Stable fingerprint of the parameters that define an intent.
 *
 * Deliberately excludes metadata and TTL: they do not change what is owed to
 * whom, so a retry that only differs there is still the same payment.
 */
function fingerprintOf(
  command: CreatePaymentIntentCommand & { settlementAsset: AssetCode; provider: string },
): string {
  const canonical = JSON.stringify([
    command.merchant.id,
    serializeMoney(command.amount),
    command.settlementAsset,
    command.provider,
    command.source.type === "qr" ? command.source.payload : "manual",
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}
