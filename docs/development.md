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

Pay something:

```bash
curl -X POST localhost:3000/payment-intents \
  -H 'content-type: application/json' \
  -H 'Idempotency-Key: order-4711' \
  -d '{"merchant":{"id":"M-1","name":"Warung Kopi","city":"Jakarta","countryCode":"ID"},
       "amount":{"amount":"50000.00","asset":"IDR"}}'

curl -X POST localhost:3000/payment-intents/<id>/confirm
curl localhost:3000/payments/<id>
```

### Commands

| Command                | Does                                                                |
| ---------------------- | ------------------------------------------------------------------- |
| `bun test`             | Runs every suite. Postgres tests are skipped without `DATABASE_URL` |
| `bun run typecheck`    | Typechecks every package                                            |
| `bun run lint`         | Lints with Biome                                                    |
| `bun run format`       | Formats everything in place                                         |
| `bun run format:check` | Fails if anything is unformatted                                    |
| `bun run check`        | Format check, typecheck and tests — the same gate CI should run     |
| `bun run db:generate`  | Regenerates migrations after a schema change                        |

The Postgres integration suite runs the full clearing flow against real
repositories:

```bash
DATABASE_URL=postgres://mayarin:mayarin@localhost:5433/mayarin bun test packages/db
```

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
- [REST API](./api.md)

[← Documentation index](./README.md)
