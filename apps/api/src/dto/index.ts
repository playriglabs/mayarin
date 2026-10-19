/**
 * DTO barrel for API clients (#14).
 *
 * `@mayarin/sdk` derives its response types from these modules through
 * type-only imports, so the wire shapes have one definition. Nothing inside
 * the API imports this file.
 *
 * Every module re-exported here reaches pure packages only (core, shared,
 * zod): the SDK build bundles this graph into its published declarations, and
 * a database or provider import fails that build. Mappers that need one live
 * beside the DTO in a `*-mapper.ts` file that is not re-exported.
 */

export * from "./catalog.ts";
export * from "./clearing.ts";
export * from "./contract-call.ts";
export * from "./deposit.ts";
export * from "./dispute.ts";
export * from "./error.ts";
export * from "./escrow.ts";
export * from "./invoice.ts";
export * from "./money.ts";
export * from "./payment.ts";
export * from "./payment-intent.ts";
export * from "./rails.ts";
export * from "./refund.ts";
export * from "./subscription.ts";
export * from "./x402-resource.ts";
