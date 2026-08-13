# Mayarin Developer Docs

Public API and TypeScript SDK documentation for `docs.mayarin.xyz`.

The application uses Astro with Fumadocs React islands. Authored guides live in
`content/docs`; API reference pages are generated at runtime from the canonical
OpenAPI 3.1 document in `src/lib/openapi.ts`; SDK type tables are derived from
`packages/sdk/src` with `fumadocs-typescript`.

## Commands

```bash
bun run dev:docs       # from the repository root
bun run build:docs

# or from apps/docs
bun run dev
bun run typecheck
bun run build
```

## Content rules

- Explain workflows in MDX; do not duplicate request or response schemas in prose.
- Add or update OpenAPI operations in the same change as a public API route.
- Add TSDoc to public SDK exports so the source-derived tables stay useful.
- Use `sk_` keys only in server examples and `pk_` keys only in browser examples.
- Keep architecture and implementation design records in the repository-level
  `docs/` directory. This application is the external integration surface.

## Visual system

The docs inherit the landing site's design language: white paper, near-black
ink, Mayarin green, Instrument Serif headings, Inter Tight body copy, JetBrains
Mono code, and Clash Display only for the wordmark. Update the landing and docs
tokens together when the brand changes.
