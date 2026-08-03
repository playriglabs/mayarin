# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Mayarin is programmable clearing infrastructure: it bridges digital assets and traditional payment
rails (QRIS, bank transfer) behind one provider-agnostic clearing layer. Bun workspace monorepo,
TypeScript, Hono API on Postgres.

Phase 1 is shipped. `docs/roadmap.md` is the authority on what each later phase adds; `docs/` as a
whole is the design record and is expected to stay in sync with the code.

## Commands

```bash
bun install                     # also installs lefthook git hooks

bun run dev                     # API with hot reload (apps/api)
bun run typecheck               # tsc --noEmit across every workspace package
bun test                        # whole suite
bun run format                  # biome --write + prettier --write
bun run format:check            # non-mutating
bun run check                   # format:check + typecheck + test

bun run db:up                   # Postgres in Docker, host port 5433
bun run db:down
bun run db:generate             # drizzle-kit generate, after editing packages/db/src/schema.ts
bun run db:migrate              # applies packages/db/migrations
```

Running one test file or one test:

```bash
bun test packages/core/clearing            # a package
bun test packages/shared/test/money.test.ts
bun test -t "rejects a fee that would consume the whole payment"
```

`packages/db/test/postgres.test.ts` skips itself unless `DATABASE_URL` is set. To run it you need a
migrated database, and `bun run --cwd packages/db migrate` does **not** inherit the root `.env`:

```bash
bun run db:up
export $(grep -E '^DATABASE_URL' .env) && bun run --cwd packages/db migrate
bun test packages/db
```

Hooks: pre-commit runs Biome on staged TS/JSON and Prettier on staged Markdown/YAML, fixing in
place. pre-push runs `typecheck` and `bun test` over the whole repo.

## Architecture

Value moves through the layers in this order, and the package tree mirrors it:

```
QR Parser → Payment Intent → Liquidity Router (Phase 2) → Clearing Engine
          → Double Entry Ledger → Settlement Adapter → merchant paid
```

**Ports and adapters is the load-bearing constraint.** Every package in `packages/core/*` defines
repository and provider _ports_ and depends on nothing concrete — no Postgres, no HTTP, no specific
settlement provider. Drizzle and in-memory implementations live in `packages/db`, deliberately
outside `core`, which is what lets a domain package be tested and swapped without a database.
`apps/api/src/container.ts` is the composition root: the only file that knows which concrete
adapters this deployment runs. Adding a dependency from `core` to a concrete adapter breaks the
property the whole layout exists to protect.

**`packages/core/clearing` is the centre.** A nine-state machine —
`CREATED → QR_PARSED → PRICE_LOCKED → PAYMENT_PENDING → ASSET_RECEIVED → CLEARING → SETTLING →
SETTLED → SUCCESS`, with `FAILED` reachable from any non-terminal state. Three invariants hold it
together:

- **Idempotent** — each step is keyed `${transactionId}:${state}`, so ledger postings and provider
  calls can be replayed without duplicating value.
- **Resumable** — persisted state is the only input a step needs. Side effects run _before_ the
  state is persisted, so a crash in between means the resumed step repeats a no-op and then records
  the state. `ClearingEngine.resumeStuck` recovers stalled payments.
- **Auditable** — every transition appends an event in the same database transaction as the state
  change.

**Money is never a float.** A `Money` is a `bigint` count of an asset's minor units plus its
`AssetCode`; `packages/shared/src/asset.ts` is the only place that knows how many minor units make a
whole unit. This holds for 2-decimal fiat and 18-decimal ERC-20 balances alike. Rates and fees are
integers (basis points, minor-units-per-whole-unit) so no float ever reaches a calculation.

Rendering has two distinct forms and they are not interchangeable: `toDecimalString` is the machine
form (ungrouped, dot-separated, round-trips exactly), `formatMoneyLocale` is the human form and
defaults to `id-ID`, where `.` groups thousands and `,` marks the decimal — `Rp 50.432,00`. On the
wire, `MoneyDto` carries `amount` (calculate), `formatted` (parse) and `display` (show, never
parse). Formatting operates on the digit string, never a `number`.

**Nothing mutates a balance directly.** Value moves only through balanced double-entry postings; an
unbalanced one raises `LedgerImbalanceError`. Chart of accounts is in
`packages/core/ledger/src/accounts.ts`.

**Aggregates are immutable.** A `PaymentIntent` transition returns a new value with an incremented
`version`, which is also the optimistic-locking token repositories use. Concurrent writes raise
`ConcurrencyError`.

**A webhook is a signal, not truth.** It wakes the clearing engine, which then asks the adapter for
the authoritative status — so a spoofed or replayed webhook cannot settle a payment on its own.

### Phase 1 stand-ins

Two seams exist specifically so Phase 2 can plug in without redesign. Do not "fix" them in place:

- No wallet watcher yet, so nothing observes the payer's asset arriving on-chain.
  `ASSET_RECEIPT_MODE=auto` treats a payment as funded on reaching `PAYMENT_PENDING`; `manual` waits
  for `recordAssetReceived`, which is the call the watcher will make.
- Prices are locked against the static `EXCHANGE_RATES` table through the same `RateProvider` port
  the liquidity router will implement.

## Conventions

The `functional-programming` skill carries the full style guide — pure domain packages, immutable
aggregates, injected effects, compiler-checked exhaustiveness — plus the reasoning behind the
throw-over-`Result` choice. It lives in `.agent/skills/` and is symlinked into `.claude/skills/`.

- Error taxonomy lives in `packages/shared/src/errors.ts`; every domain error extends
  `MayarinError` and carries a `code` and a `retryable` flag. Expected failures are thrown, not
  returned — the clearing engine branches on `isMayarinError(error) && error.retryable`, and
  `apps/api/src/errors.ts` maps the taxonomy onto HTTP status in one place. Optional values are
  `T | undefined`, not an `Option` type.
- `packages/shared/src/clock.ts` — inject a `Clock`; no `Date.now()` inside domain logic. Tests use
  `FixedClock`.
- TypeScript is strict plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and
  `noUnusedLocals`. Biome bans `any`, non-null assertions and untyped throws (relaxed for `any` in
  test files only).
- Imports use explicit `.ts` extensions inside a package; cross-package imports go through the
  `@mayarin/*` workspace names.
- Biome owns TS/JS/JSON; Prettier owns Markdown/YAML. `packages/db/migrations` is excluded from
  Biome.
- Commit messages carry no Claude or Anthropic attribution trailer.
