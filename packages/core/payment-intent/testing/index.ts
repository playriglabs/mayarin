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
    const q = options.q?.toLocaleLowerCase();
    const sort = options.sort ?? "-created";
    const scoped = [...this.#byId.values()]
      .filter(
        (intent) => options.merchantId === undefined || intent.merchant.id === options.merchantId,
      )
      .filter(
        (intent) =>
          options.merchantReference === undefined ||
          intent.merchantReference === options.merchantReference,
      )
      .filter(
        (intent) =>
          q === undefined ||
          intent.id.toLocaleLowerCase().includes(q) ||
          intent.merchantReference?.toLocaleLowerCase().includes(q) === true,
      )
      .filter((intent) => options.status === undefined || intent.status === options.status)
      .filter((intent) => options.from === undefined || intent.createdAt >= options.from)
      .filter((intent) => options.to === undefined || intent.createdAt < options.to)
      .sort((a, b) => compareIntents(a, b, sort))
      .filter((intent) =>
        options.cursor === undefined
          ? true
          : compareIntentToCursor(intent, options.cursor, sort) > 0,
      );
    return scoped.slice(0, limit);
  }
}

function compareIntents(
  a: PaymentIntent,
  b: PaymentIntent,
  sort: NonNullable<ListPaymentIntentsOptions["sort"]>,
): number {
  if (sort === "-amount") {
    if (a.amount.amount !== b.amount.amount) return a.amount.amount > b.amount.amount ? -1 : 1;
    return b.id.localeCompare(a.id);
  }
  const direction = sort === "created" ? 1 : -1;
  const time = a.createdAt.getTime() - b.createdAt.getTime();
  return time === 0 ? direction * a.id.localeCompare(b.id) : direction * time;
}

function compareIntentToCursor(
  intent: PaymentIntent,
  cursor: NonNullable<ListPaymentIntentsOptions["cursor"]>,
  sort: NonNullable<ListPaymentIntentsOptions["sort"]>,
): number {
  const cursorIntent: PaymentIntent = {
    ...intent,
    id: cursor.id,
    createdAt: cursor.createdAt,
    amount:
      cursor.amount === undefined ? intent.amount : { ...intent.amount, amount: cursor.amount },
  };
  return compareIntents(intent, cursorIntent, sort);
}
