/**
 * Reference fixtures for the x402 protocol types, in a segregated `/testing`
 * subpath so domain `src/` stays pure.
 *
 * The values are the specification's own examples. A test that passes against
 * them is passing against the bytes a real payer's client produces, rather than
 * against a shape we invented and then implemented twice.
 */

export * from "./fixtures.ts";
