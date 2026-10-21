# Mayarin Developer Docs

Public API and TypeScript SDK documentation for `docs.mayarin.xyz`.

The application is [Vocs](https://vocs.dev) (Waku). Authored guides are MDX
under `src/pages`, and the sidebar is written by hand in `vocs.config.ts`. The
API reference is generated from the canonical OpenAPI 3.1 document in
`src/lib/openapi.json`, and SDK type tables are derived from `packages/sdk/src`.

The OpenAPI document is **generated**, not hand-maintained. Request bodies are
single-sourced from the live API Zod schemas in `apps/api/src/dto`; response
schemas are authored in `scripts/generate-openapi.ts`. Run the generator after a
route or DTO change and commit the result — CI fails when the checked-in
artifact is stale.

## Commands

```bash
bun run dev:docs              # from the repository root
bun run build:docs
bun run docs:generate-openapi # regenerate src/lib/openapi.json
bun run docs:openapi:check    # fail if the checked-in artifact is stale

# or from apps/docs
bun run dev
bun run typecheck
bun run build
bun run generate              # openapi.json
bun run generate:api-pages    # src/pages/api-reference/<tag>.mdx
bun run generate:types        # type tables on sdk/typescript/reference.mdx
bun run openapi:check
bun run api-pages:check
bun run types:check
```

## Generated files

- `src/lib/openapi.json` — from `scripts/generate-openapi.ts`.
- `src/pages/api-reference/<tag>.mdx` — one page per OpenAPI tag, from
  `scripts/generate-api-pages.ts`. Vocs would mount these itself from the
  `openapi` entry in `vocs.config.ts`, but 2.10 drops `openapi` from its runtime
  config, so the pages are written out and embed `<OpenApi.Operation>`. Run
  `generate:api-pages` after a new tag or operation. `index.mdx` there is
  authored.
- The tables between `{/* types: … */}` and `{/* /types */}` in
  `src/pages/sdk/typescript/reference.mdx` — from `scripts/generate-type-tables.ts`.

The API playground is the Vocs **Try** modal on each operation. It takes its
servers and `sk_`/`pk_` bearer schemes from the OpenAPI document.

## Content rules

- Explain workflows in MDX; do not duplicate request or response schemas in prose.
- Add or update OpenAPI operations in the same change as a public API route.
- Add TSDoc to public SDK exports so the source-derived tables stay useful.
- Use `sk_` keys only in server examples and `pk_` keys only in browser examples.
- A new page needs an entry in the sidebar in `vocs.config.ts`.
- Keep architecture and implementation design records in the repository-level
  `docs/` directory. This application is the external integration surface.
