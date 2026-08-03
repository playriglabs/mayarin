---
name: functional-programming
description: >-
  Use when writing or refactoring any TypeScript in this repo. Enforces the
  functional style the codebase already follows: pure domain packages, immutable
  aggregates, injected effects, discriminated unions and exhaustive matching.
  Also records where the codebase deliberately diverges from textbook FP —
  typed throws rather than Result — so a refactor is a decision, not a reflex.
---

# Functional programming style

Write new code this way and nudge refactors toward it — pragmatically, not
dogmatically. Don't rewrite working code purely for style; apply this when you
touch a file or add logic.

## What already holds

These are properties of the codebase today, not aspirations. Preserve them.

1. **Pure domain packages.** Everything in `packages/core/*` and
   `packages/shared` is inputs → outputs: no I/O, no hidden mutation, no
   `Date.now()`. Time arrives through the injected `Clock`
   (`packages/shared/src/clock.ts`); tests pass `FixedClock`. Repositories and
   settlement providers are _ports_ the domain defines and never implements.
2. **Effects live at the edges.** Postgres in `packages/db`, HTTP in
   `apps/api`. `apps/api/src/container.ts` is the composition root — the only
   file that names concrete adapters. A `packages/core/*` import of a concrete
   adapter breaks the property the layout exists to protect.
3. **Immutable aggregates.** `PaymentIntent` and `ClearingTransaction`
   transitions return a new value with an incremented `version`, which doubles
   as the optimistic-locking token. Nothing mutates in place. `readonly` on
   props and arrays, `as const` on lookup tables.
4. **Discriminated unions over boolean soup.** `PaymentSource` is
   `{ type: "qr"; ... } | { type: "manual" }`. Model state as a tagged union and
   branch on the tag.
5. **Integer arithmetic, no floats.** `Money` is a `bigint` of minor units;
   rates and fees are integers (basis points, minor-units-per-whole-unit). A
   float in a money path is a bug, not a style preference.
6. **Total transition tables.** `packages/core/clearing/src/state-machine.ts`
   encodes transitions as `Readonly<Record<ClearingState, …>>`, so adding a
   state is a compiler error at every table rather than a silent fallthrough.
   Prefer this shape to hand-written branching.

## Writing new code

- Small named functions over one imperative block. `map`/`filter`/`reduce` over
  `for`-loop mutation.
- Exhaustiveness must be compiler-checked. The two `switch` statements in
  `engine.ts` cover a union with no `default` — `noFallthroughCasesInSwitch` and
  the return type do the checking. Keep that property; never add a `default`
  that swallows an unhandled case.
- New lookup tables get `Readonly<Record<Union, …>>` and `as const`, so the
  compiler enforces totality.
- No `any`, no non-null assertions — Biome errors on both.
  `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on, so index
  results are `T | undefined` and optional props cannot be assigned `undefined`
  explicitly. Handle the `undefined`, do not assert it away.

## Where this repo diverges from textbook FP

**Errors are thrown, not returned.** Roughly fifty sites across `packages/core`
and `packages/shared` throw a `MayarinError` subclass — including for expected
outcomes, not just invariant violations. `fromDecimalString` throws
`ValidationError` on a malformed string; `SettlementAdapterRegistry` throws on an
unregistered provider.

That is a deliberate, coherent design: the taxonomy in
`packages/shared/src/errors.ts` carries a `code` and a `retryable` flag, the
clearing engine branches on `isMayarinError(error) && error.retryable`, and
`apps/api/src/errors.ts` maps the taxonomy onto HTTP status codes in one place.

So **do not thread `Result` through new domain code on style grounds.** It would
sit alongside fifty throw sites and two error-handling idioms, which is worse
than either one alone. Optional values are modelled as `T | undefined`
(`assetFromIso4217Numeric`, `nextState`, `assetSymbol`) and that is the
convention to follow.

Moving to `Result` is a real option, but it is a repo-wide migration touching the
error taxonomy, the engine's retry branch and the HTTP error mapper. Raise it as
a proposal; do not start it inside an unrelated change.

## Libraries

**None of the following are installed.** Adding one is a dependency decision for
the repo owner, not something to do mid-task.

- **ts-pattern** — pattern matching with `.exhaustive()`. The natural first
  choice if hand-rolled exhaustiveness ever stops being enough. Lowest cost of
  the three.
- **@mobily/ts-belt** — `pipe`, `flow`, `Option`, `Result`, array/dict/string
  combinators. Would belong in the pure `packages/core/*` and
  `packages/shared`. Note the `Result` tension above before reaching for it.
- **effect** — only for effectful orchestration that genuinely benefits from
  typed errors plus dependency injection, e.g. the Phase 2 wallet watcher or a
  batch worker. Do not pull Effect into the clearing hot path.

Install per package, not at the root:

```bash
bun add --cwd packages/core/clearing ts-pattern
```

## Boundaries / anti-dogma

- Zod schemas, Drizzle query builders and Hono handlers stay idiomatic. Don't
  FP-wrap framework APIs into knots.
- Tests are `bun:test` (`describe`/`test`/`expect`), run with `bun test`.
- Don't introduce a monad stack where a plain pure function reads clearer. FP
  here means clarity and testability, not maximal abstraction.
- One FP utility library per concern — never mix two `Result` types in a module.
