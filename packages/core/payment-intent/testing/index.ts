/**
 * Reference in-memory fake for the payment-intent repository, shipped in a
 * segregated `/testing` subpath so domain `src/` stays pure.
 *
 * Mirrors the guarantees of the Postgres implementation — unique idempotency
 * keys, optimistic locking — so tests exercise the same failure modes without a
 * database.
 */

import { ConcurrencyError, ConflictError } from "@mayarin/shared";
import type {
  ListPaymentIntentsOptions,
  PaymentIntent,
  PaymentIntentRepository,
} from "../src/index.ts";

export class InMemoryPaymentIntentRepository implements PaymentIntentRepository {
  readonly #byId = new Map<string, PaymentIntent>();
  readonly #byIdempotencyKey = new Map<string, string>();

  async insert(intent: PaymentIntent): Promise<void> {
    if (this.#byId.has(intent.id)) {
      throw new ConflictError(`Payment intent ${intent.id} already exists`, { id: intent.id });
    }
    if (intent.idempotencyKey !== undefined) {
      if (this.#byIdempotencyKey.has(intent.idempotencyKey)) {
        throw new ConflictError(`Idempotency key "${intent.idempotencyKey}" is already in use`, {
          idempotencyKey: intent.idempotencyKey,
        });
      }
      this.#byIdempotencyKey.set(intent.idempotencyKey, intent.id);
    }
    this.#byId.set(intent.id, intent);
  }

  async findById(id: string): Promise<PaymentIntent | null> {
    return this.#byId.get(id) ?? null;
  }

  async findByIdempotencyKey(key: string): Promise<PaymentIntent | null> {
    const id = this.#byIdempotencyKey.get(key);
    return id === undefined ? null : (this.#byId.get(id) ?? null);
  }

  async update(intent: PaymentIntent, expectedVersion: number): Promise<void> {
    const current = this.#byId.get(intent.id);
    if (current === undefined) {
      throw new ConflictError(`Payment intent ${intent.id} does not exist`, { id: intent.id });
    }
    if (current.version !== expectedVersion) {
      throw new ConcurrencyError(`Payment intent ${intent.id} was modified concurrently`, {
        id: intent.id,
        expectedVersion,
        actualVersion: current.version,
      });
    }
    this.#byId.set(intent.id, intent);
  }

  async list(options: ListPaymentIntentsOptions = {}): Promise<readonly PaymentIntent[]> {
    const limit = options.limit ?? 100;
    const all = [...this.#byId.values()];
    const scoped =
      options.merchantId === undefined
        ? all
        : all.filter((intent) => intent.merchant.id === options.merchantId);
    return scoped.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
  }
}
