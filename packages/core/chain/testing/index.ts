/**
 * Reference in-memory fakes for the chain ports, shipped in a segregated
 * `/testing` subpath so domain `src/` stays pure. The fakes enforce the same
 * invariants as the Postgres adapters in `@mayarin/db`, so a test that passes
 * against them is not passing for the wrong reason.
 */

export * from "./chain.ts";
export * from "./deriver.ts";
export * from "./fake-chain.ts";
