[← Documentation index](./README.md)

# Development

Running Mayarin locally, and the tooling that keeps the codebase consistent.

---

## Getting Started

Requires [Bun](https://bun.sh) 1.2+ and Docker.

```bash
bun install
cp .env.example .env

bun run db:up          # Postgres in Docker
bun run db:migrate     # apply migrations

bun run dev            # API on http://localhost:3000
```

Pay something. Creating an intent is a merchant act, so it needs an API key —
`bun run seed:merchant` prints one (`apiKey:`) when it creates the merchant:

```bash
curl -X POST localhost:3000/v1/payment-intents \
  -H 'content-type: application/json' \
  -H 'Authorization: Bearer <apiKey from seed:merchant>' \
  -H 'Idempotency-Key: order-4711' \
  -d '{"merchant":{"id":"M-1","name":"Warung Kopi","city":"Jakarta","countryCode":"ID"},
       "amount":{"amount":"50000.00","asset":"IDR"}}'

curl -X POST localhost:3000/v1/payment-intents/<id>/confirm
curl localhost:3000/v1/payments/<id>
```

### Commands

| Command                       | Does                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------- |
| `bun run dev:dashboard:local` | Wipes local Postgres, migrates, seeds a merchant, then starts the dashboard flow |
| `bun test`                    | Runs every suite. Postgres tests are skipped without `TEST_DATABASE_URL`         |
| `bun run typecheck`           | Typechecks every package                                                         |
| `bun run lint`                | Lints with Biome                                                                 |
| `bun run format`              | Formats everything in place                                                      |
| `bun run format:check`        | Fails if anything is unformatted                                                 |
| `bun run check`               | Format check, typecheck and tests — the same gate CI should run                  |
| `bun run db:generate`         | Regenerates migrations after a schema change                                     |

`dev:dashboard:local` is intentionally destructive to the local Docker
database. It performs these steps in order:

1. Installs workspace dependencies and validates `.env`.
2. Removes and recreates the local Postgres Docker volume.
3. Waits for Postgres and applies every migration from an empty database.
4. Prompts for the first merchant account and seeds it.
5. Starts the core API, dashboard API, and dashboard.

The reset targets only the local Compose database. The underlying wipe/reset
guard refuses non-local database hosts.

The Postgres integration suite runs the full clearing flow against real
repositories. It truncates every table it touches, so it keys on its own
variable — `DATABASE_URL` from `.env` never runs it:

```bash
TEST_DATABASE_URL=postgres://mayarin:mayarin@localhost:5433/mayarin bun test packages/db
```

---

## Chain Layer

The chain layer is off by default — an existing deployment boots unchanged. To
watch a chain, enable it and point it at an RPC. Base Sepolia is the
out-of-the-box target:

```bash
CHAIN_ENABLED=true
ASSET_RECEIPT_MODE=manual
DEPOSIT_XPUB=xpub6...                       # watch-only BIP-32/44 account xpub
CHAIN_RPC_URLS={"base-sepolia":"https://sepolia.base.org"}
CHAIN_ASSETS={"base-sepolia":{"USDC":"0x036CbD53842c5426634e7929541eC2318f3dCF7e"}}
CHAIN_CONFIRMATIONS={"base-sepolia":6}
CHAIN_START_BLOCKS={"base-sepolia":"0"}
WATCHER_INTERVAL_MS=15000
ADMIN_TOKEN=...
```

`ASSET_RECEIPT_MODE` must be `manual` once the layer is on; `auto` alongside a
live watcher would fund payments nobody paid, and the config rejects it at boot.
With the timer running, the watcher scans each configured `(chain, asset)` pair
every `WATCHER_INTERVAL_MS`. `WATCHER_INTERVAL_MS=0` disables the timer and
leaves only the admin trigger:

```bash
curl -X POST localhost:3000/v1/admin/watcher/tick -H "authorization: Bearer $ADMIN_TOKEN"
```

Every variable is optional and validated at boot the way `EXCHANGE_RATES` is, so
a half-configured layer fails to start rather than failing on its first payment.
See [Chain Layer](./chain.md) for what the watcher does and why.

---

## Stablecoin Registry

Which stablecoins a deployment admits — and where each lives on-chain — is
declared in two env vars that the registry unions at boot:

```bash
SETTLEMENT_ASSETS=["IDRX","USDC","USDT"]      # admissible settlement set (ledger-only allowed)
CHAIN_ASSETS={"base-sepolia":{"USDC":"0x..."}} # on-chain identities; also admitted for settlement
SETTLEMENT_ASSET=IDRX                          # default; must be in the admitted union
```

`SETTLEMENT_ASSETS` carries ledger-only stablecoins (no on-chain identity, like
`IDRX` when a deployment credits it internally); `CHAIN_ASSETS` carries the
on-chain identities the watcher also needs. Every asset in either must be a
known stablecoin (`kind === "stablecoin"`); a non-stablecoin or an unknown code
fails to boot. A merchant may ask for any admitted settlement asset; a payer's
`payment: { asset, chain }` must be a deposit asset the registry knows. See
[Stablecoin Registry](./stablecoin.md).

---

---

## Tooling

### Formatting and linting

Two tools, no overlap — running both over the same file would mean two
formatters disagreeing forever.

| Tool     | Owns                         | Config             |
| -------- | ---------------------------- | ------------------ |
| Biome    | TypeScript, JavaScript, JSON | `biome.json`       |
| Prettier | Markdown, YAML               | `.prettierrc.json` |

Biome handles linting, formatting and import sorting in a single pass;
`.prettierignore` explicitly excludes everything Biome owns.

Rules worth knowing about: `noExplicitAny` and `noNonNullAssertion` are errors
(relaxed for `any` in tests), `useImportType` keeps type-only imports erasable,
and generated migrations are excluded from both tools.

### Git hooks

Managed by [lefthook](https://lefthook.dev) (`lefthook.yml`), installed
automatically by `bun install` via the `prepare` script — or manually:

```bash
bunx lefthook install
```

| Hook         | Runs                                                                          |
| ------------ | ----------------------------------------------------------------------------- |
| `pre-commit` | Biome and Prettier over **staged files only**, fixing and re-staging in place |
| `pre-push`   | `typecheck` then `test` across the whole repo                                 |

pre-commit stays fast because it never looks at files you did not touch;
pre-push is the slow gate that keeps a broken build off a shared branch.

Skip in an emergency with `LEFTHOOK=0 git push` — and fix it immediately after.

### Editors

`.editorconfig` covers the basics everywhere. `.vscode/settings.json` and
`.vscode/extensions.json` are committed so every contributor gets the same
formatters, with format-on-save and import organisation wired to Biome.

---

## Related

- [Architecture](./architecture.md)
- [Chain Layer](./chain.md)
- [Stablecoin Registry](./stablecoin.md)
- [REST API](./api.md)

[← Documentation index](./README.md)
