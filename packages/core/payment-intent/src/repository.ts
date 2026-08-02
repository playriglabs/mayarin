import type { PaymentIntent } from "./types.ts";

/**
 * Persistence port for payment intents.
 *
 * The domain owns this contract; adapters (Drizzle, in-memory) implement it.
 * `update` takes the version the caller read so a lost update surfaces as a
 * `ConcurrencyError` instead of overwriting another writer's transition.
 */
export interface PaymentIntentRepository {
  insert(intent: PaymentIntent): Promise<void>;
  findById(id: string): Promise<PaymentIntent | null>;
  findByIdempotencyKey(key: string): Promise<PaymentIntent | null>;
  update(intent: PaymentIntent, expectedVersion: number): Promise<void>;
}
