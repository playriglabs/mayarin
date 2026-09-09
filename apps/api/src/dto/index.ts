/**
 * DTO barrel for API clients (#14).
 *
 * `@mayarin/sdk` derives its response types from these modules through
 * type-only imports, so the wire shapes have one definition. Nothing inside
 * the API imports this file.
 */

export type { ErrorBody } from "../errors.ts";
export * from "./catalog.ts";
export * from "./clearing.ts";
export * from "./contract-call.ts";
export * from "./deposit.ts";
export * from "./invoice.ts";
export * from "./money.ts";
export * from "./payment.ts";
export * from "./payment-intent.ts";
export * from "./rails.ts";
export * from "./refund.ts";
export * from "./x402-payable.ts";
export * from "./x402-resource.ts";
