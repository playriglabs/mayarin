/**
 * Reference fixtures and fakes for x402, in a segregated `/testing` subpath so
 * domain `src/` stays pure.
 *
 * The fixtures are the specification's own example payloads, so a test that
 * passes against them is passing against the bytes a real payer's client
 * produces rather than against a shape we invented and then implemented twice.
 * The fakes are scriptable specifically so they can lie — a facilitator
 * reporting a settlement that never happened is the failure the confirmation
 * guard exists to catch, and a correct implementation will never produce it.
 */

export * from "./fake-cross-asset-settler.ts";
export * from "./fake-facilitator.ts";
export * from "./fixtures.ts";
export * from "./in-memory-resources.ts";
