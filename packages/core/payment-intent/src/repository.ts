import type { PaymentIntent } from "./types.ts";

/**
 * Persistence port for payment intents.
 *
 * The domain owns this contract; adapters (Drizzle, in-memory) implement it.
 * `update` takes the version the caller read so a lost update surfaces as a
 * `ConcurrencyError` instead of overwriting another writer's transition.
 */
export interface ListPaymentIntentsOptions {
  /** When set, restricts to one merchant's intents — the dashboard scope filter. */
  readonly merchantId?: string;
  /**
   * When set, restricts to intents carrying this merchant reference. How a
   * merchant finds the payment for their own order id, including the earlier
   * attempts that expired.
   */
  readonly merchantReference?: string;
  /** Caps the page size; defaults to the adapter's own bound. */
  readonly limit?: number;
}

export interface PaymentIntentRepository {
  insert(intent: PaymentIntent): Promise<void>;
  findById(id: string): Promise<PaymentIntent | null>;
  findByIdempotencyKey(key: string): Promise<PaymentIntent | null>;
  update(intent: PaymentIntent, expectedVersion: number): Promise<void>;
  /**
   * Lists intents newest-first. Scoped to a merchant when `merchantId` is set,
   * which is what backs the dashboard's merchant/admin visibility split.
   */
  list(options?: ListPaymentIntentsOptions): Promise<readonly PaymentIntent[]>;
}
