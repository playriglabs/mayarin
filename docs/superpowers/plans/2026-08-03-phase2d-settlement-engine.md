# Phase 2D — Settlement Engine: implementation plan

> Design: `docs/superpowers/specs/2026-08-03-phase2d-settlement-engine-design.md`.
> Rhythm: TDD. Write a failing test, watch it fail, implement, run
> `bun run typecheck && bun test`, commit. One task per commit.

## Task 1 — `MERCHANT_HOLDING` ledger account kind

In `packages/core/ledger/src/accounts.ts`, add `MERCHANT_HOLDING` to
`ACCOUNT_KINDS` (`type: "LIABILITY"`, name "Merchant holding", description
"Stablecoin balances credited to merchants, withdrawable on-chain in Phase 4.").
`AccountKind`, `ACCOUNT_KIND_LIST`, `accountCode`, `parseAccountCode`,
`accountName` derive automatically. Add a test in the ledger suite: the kind is
in `ACCOUNT_KINDS` and `ACCOUNT_KIND_LIST`; `parseAccountCode("MERCHANT_HOLDING:USDC")`
returns `{ kind: "MERCHANT_HOLDING", asset: "USDX", ... }` with `type === "LIABILITY"`;
`accountName("MERCHANT_HOLDING", "USDC")` includes the asset.

Commit: `feat(ledger): add the merchant holding account kind`

## Task 2 — `internalSettledPosting`

In `packages/core/clearing/src/postings.ts`, add `internalSettledPosting(transaction)`:
`Dr SETTLEMENT_IN_FLIGHT (net)`, `Cr MERCHANT_HOLDING (net)`, idempotency key
`postingIdempotencyKey(transaction, "SETTLED")` (same key as `settledPosting` —
exactly one of the two ever runs per transaction). Reuse `requirePricedAmounts`
for the net and the imbalance guard. Export from `src/index.ts`. Add a test in
`packages/core/clearing/test/postings.test.ts` (or the engine test file if no
postings test exists — check first): the posting debits `SETTLEMENT_IN_FLIGHT`
and credits `MERCHANT_HOLDING` for `netAmount`, with the `SETTLED` idempotency
key, and throws `LedgerImbalanceError` when amounts are not locked (matching
`settledPosting`).

Commit: `feat(clearing): add the internal settled posting`

## Task 3 — `SettlementMode` on the `SettlementAdapter` port

In `packages/core/settlement/src/types.ts`, add `export type SettlementMode =
"external" | "internal"` and a `readonly mode: SettlementMode` field on
`SettlementAdapter`. Update `packages/providers/mock/src/adapter.ts` to declare
`readonly mode = "external" as const` (and accept an optional `mode` in
`MockSettlementAdapterOptions` for tests that want to force it, defaulting
`"external"`). Add a test: the mock adapter's `mode` is `"external"` by default.
Typecheck catches any other implementor — there is none besides the mock and the
harness stubs (check `packages/core/clearing/test/harness.ts` and
`packages/db/test/postgres.test.ts` for inline adapter stubs that must add
`mode`).

Commit: `feat(settlement): add a mode discriminator to the adapter port`

## Task 4 — Engine branches on `adapter.mode` at SETTLED

In `packages/core/clearing/src/engine.ts`, `#confirmSettlement` SUCCEEDED branch:
look up the adapter (`this.#adapters.get(transaction.provider)` — already fetched
above for the `status` call; reuse it), and post `internalSettledPosting` when
`adapter.mode === "internal"`, else the existing `settledPosting`. Add a test in
`packages/core/clearing/test/engine.test.ts` (or the collaboration harness) that
drives a payment through `CLEARING → SETTLING → SETTLED` with an internal-mode
adapter and asserts `balance(MERCHANT_HOLDING, settlementAsset)` equals the net
payout and `SETTLEMENT_IN_FLIGHT` is zeroed — and that the external mock flow
still credits `TREASURY`, not `MERCHANT_HOLDING`.

Commit: `feat(clearing): credit merchant holding for internal settlements`

## Task 5 — `StablecoinSettlementAdapter`

New package `packages/providers/stablecoin` (`@mayarin/provider-stablecoin`,
deps `@mayarin/settlement`, `@mayarin/shared`; `tsconfig`; `src/index.ts`).
`src/adapter.ts`: `StablecoinSettlementAdapter implements SettlementAdapter` with
`name = "stablecoin"`, `mode = "internal" as const`. In-memory `Map` keyed by
`providerReference`, plus `idempotencyKey → providerReference` so a replayed
`settle` returns the same result. `settle` records and returns `SUCCEEDED`
synchronously (with `settledAt = clock.now()`); `status` returns the recorded
state; `refund` flips to `REFUNDED`; `webhook` returns `null` (internal rail has
no external webhook, but the contract requires the method). Inject a `Clock`
(default `systemClock`) and an optional `name`. `test/adapter.test.ts`:
idempotent `settle` (same key → same `providerReference`); `status` after
`settle` is `SUCCEEDED`; `mode` is `"internal"`; `refund` transitions to
`REFUNDED`; `webhook` returns `null`.

Commit: `feat(provider-stablecoin): add the internal stablecoin settlement adapter`

## Task 6 — Wire the adapter into the composition root and harness

In `apps/api/src/container.ts`: import `StablecoinSettlementAdapter`, construct
it (inject the shared `clock`), and register it in the
`SettlementAdapterRegistry` alongside the mock, keyed `"stablecoin"`. Mirror in
`apps/api/test/harness.ts`. No default-provider change — an intent opts in with
`provider: "stablecoin"`. Add a route/integration test (or extend an existing
one) that creates an intent with `provider: "stablecoin"` and an admitted
settlement asset, drives it to `SUCCESS`, and asserts the merchant holding
balance. Run the full suite; the mock-only flows must pass unchanged.

Commit: `feat(api): wire the stablecoin settlement adapter`

## Task 7 — Documentation

Update `docs/roadmap.md` (mark Settlement Engine ✓; the Blockchain subsection's
Settlement Engine bullet and the note that the merchant is paid internally),
`docs/architecture.md` (add `MERCHANT_HOLDING` to the account chart prose, note
the `mode` discriminator and the internal vs external settled posting),
`docs/settlement.md` (house-style update: internal vs external settlement, the
stablecoin adapter, watch-only upheld, on-chain payout is Phase 4), and
`docs/ledger.md` (add `MERCHANT_HOLDING` to the chart of accounts and the
end-to-end posting diagram for an internal settlement). Run `bun run check`.
Commit:

`docs: document the settlement engine`

## Notes

- 2D is domain- and wiring-only: **no Drizzle table**, no migration, no network,
  no signing. The adapter is pure in-memory; the engine posts.
- Do not change the clearing state machine, `#settle`, `#lockPrice`, or the
  external settled posting. Only the SUCCEEDED branch gains a mode check.
- Do not add on-chain payout or orphan-deposit sweep; both need a signature and
  are Phase 4.
- Do not add per-merchant balance views; `MERCHANT_HOLDING:ASSET` is aggregate,
  like `MERCHANT_PAYABLE:ASSET`.
- `mode` is required on the port — every adapter declares it. The mock is
  `"external"`; the stablecoin adapter is `"internal"`.
