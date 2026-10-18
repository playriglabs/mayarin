/**
 * Idempotency keys are the caller's string, so on their own they collide: two
 * tenants picking `order-1`, or one tenant using the same key on two endpoints
 * that write the same table (SEC-02, SEC-10). The stored key names who asked
 * and what for, so a key only ever replays the operation it was first used on.
 *
 * `owner` is a tenant or resource id and `operation` a fixed literal, neither
 * holding a colon, so the caller's own colons cannot shift a boundary.
 */
export type IdempotentOperation =
  | "payment-intent"
  | "cart-checkout"
  | "link-create"
  | "link-checkout"
  | "invoice-create"
  | "refund";

export function scopedIdempotencyKey(
  owner: string,
  operation: IdempotentOperation,
  key: string,
): string {
  return `${owner}:${operation}:${key}`;
}
