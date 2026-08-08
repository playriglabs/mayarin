# AGENT.md

Agent guidance for working in this repository. Tool-agnostic — any AI coding
agent (Claude Code, Cursor, Copilot, Codex, etc.) reads this directly or via its
own pointer file (e.g. `CLAUDE.md`, `.cursorrules`, `AGENTS.md`). Keep this file
free of tool-specific configuration; that belongs in the pointer file.

## What this is

Mayarin is **programmable crypto-commerce infrastructure**: merchants price in
their local currency and settle in a stablecoin; customers pay with any
supported crypto asset. One provider-agnostic clearing layer bridges the two so
merchants never need to understand blockchain. Bun workspace monorepo,
TypeScript, Hono API on Postgres.

Fiat payment rails (QRIS, bank transfer) and a stablecoin → fiat off-ramp are
intentionally **out of the MVP** — later, explicit phases with their own custody
perimeter.

Phases 1 through 3 are shipped; Phase 4 (commerce platform) is next.
`docs/roadmap.md` is the authority on what each phase adds; `docs/` as a whole is
the design record and is expected to stay in sync with the code. RFC issues
(#4–#21 on GitHub, labeled `rfc` + `phase-N`) track Phase 3–5 feature work.

## Commands

```bash
bun run setup                   # clone to running: install, .env, db, migrate, config check
bun run setup -- --check        # report drift only, change nothing
bun run setup -- --seed         # also create the first merchant account
bun run setup -- --reset-db     # drop the Postgres volume, migrate from empty

bun install                     # also installs lefthook git hooks

bun run dev                     # API with hot reload (apps/api)
bun run dev:all                 # turbo dev: payment API + dashboard API + dashboard UI, concurrently
bun run typecheck               # tsc --noEmit across every workspace package
bun test                        # whole suite
bun run test:contracts          # forge test in packages/contracts/payment-router (needs Foundry, not managed by bun)
bun run format                  # biome --write + prettier --write
bun run format:check            # non-mutating
bun run check                   # format:check + typecheck + test

bun run db:up                   # Postgres in Docker, host port 5433
bun run db:down
bun run db:generate             # drizzle-kit generate, after editing packages/db/src/schema.ts
bun run db:migrate              # applies packages/db/migrations
bun run db:studio               # drizzle-kit studio (tunnel to local.drizzle.studio)
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
QR Parser → Payment Intent → Liquidity Router → Clearing Engine
          → Double Entry Ledger → Settlement Adapter → merchant paid

        Chain Layer → drives ASSET_RECEIVED via recordAssetReceived
```

**Ports and adapters is the load-bearing constraint.** Every package in `packages/core/*` defines
repository and provider _ports_ and depends on nothing concrete — no Postgres, no HTTP, no specific
settlement provider. The Drizzle (Postgres) implementations live in `packages/db`, deliberately
outside `core`, which is what lets a domain package be swapped without reworking the persistence
layer. The reference in-memory fakes ship with their port, in each core package's segregated
`/testing` subpath (`@mayarin/<pkg>/testing`) — outside domain `src/`, which stays pure — so a
domain package is testable without a database AND without depending on `@mayarin/db` (which would
form a `core ↔ db` cycle and break Turbo's topological `^typecheck` caching). `apps/api/src/container.ts`
is the composition root: the only file that knows which concrete adapters this deployment runs.
Adding a dependency from `core` to a concrete adapter breaks the property the whole layout exists to
protect. The chain layer follows the same rule one-way: `packages/core/chain` knows the clearing
engine's `recordAssetReceived` seam only as an injected sink, so it never imports `@mayarin/clearing`;
`packages/providers/evm` holds the viem `ChainClient` and HD deposit-address deriver, outside `core`.

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

### Wired seams (Phase 2)

The `RateProvider` port is the seam later phases plug into without redesign: the
`LiquidityRouter` implements it, pricing cross-asset quotes through a pluggable
`PriceSource` (`packages/core/clearing/src/liquidity.ts`) instead of the static
`EXCHANGE_RATES` table. The table remains the default for a deployment with
`QUOTE_ENABLED=false`; with the quote layer on, a DEX `PriceSource`
(Uniswap/0x/LiFi) serves it, guarded against a Pyth or Chainlink reference. Do
not "fix" the port in place — swap the source.

The wallet watcher exists (`packages/core/chain` + `packages/providers/evm`), so a
payment waits for the payer's asset to arrive on a per-intent deposit address
rather than being treated as funded at `PAYMENT_PENDING`.
`ASSET_RECEIPT_MODE=auto` is a boot failure when the chain layer is enabled. See
`docs/chain.md`.

The stablecoin settlement adapter (`packages/providers/stablecoin`) is wired as
the off-chain settlement path. On-chain settlement (contract → merchant Safe)
supersedes it wherever `PaymentRouter` executes — the contract path always, and
the deposit path once a treasury executor is wired. The adapter port is retained
for a deployment with no executor and for the future fiat off-ramp.

## Conventions

The `functional-programming` skill carries the full style guide — pure domain packages, immutable
aggregates, injected effects, compiler-checked exhaustiveness — plus the reasoning behind the
throw-over-`Result` choice. Its source lives in `.agent/skills/`; point your agent's skill loader
there (Claude Code uses a symlink in `.claude/skills/`, Cursor/Copilot can reference the path
directly).

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

## Something that you should understand

- "I prefer stupid simple code instead of smart one"
- "No need to create fallback and backward compatibility unless user asking to do so"
