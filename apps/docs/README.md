# Mayarin Developer Docs

Public API and TypeScript SDK documentation for `docs.mayarin.xyz`.

The application uses Astro with Fumadocs React islands. Authored guides live in
`content/docs`; API reference pages are generated from the canonical OpenAPI 3.1
document in `src/lib/openapi.json`; SDK type tables are derived from
`packages/sdk/src` with `fumadocs-typescript`.

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
bun run generate
bun run openapi:check
```

## Ask AI

The **Ask AI** button opens a chat that answers from these docs.
`POST /api/ask` runs a small agent (`src/lib/ask-ai.ts`, Vercel AI SDK) with
three tools: `search_docs` (the same Orama index as the search dialog),
`read_page` (a page's MDX, cut at 8,000 characters) and `get_api_operation`
(`src/lib/openapi.json`).

The model is gpt-oss-120b on Cloudflare Workers AI, through its
OpenAI-compatible endpoint, with reasoning effort set to `low`. Set on the docs server:

| Variable                | Required | Meaning                                                    |
| ----------------------- | -------- | ---------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID` | yes      | The Cloudflare account that runs Workers AI                |
| `CLOUDFLARE_AI_TOKEN`   | yes      | An API token with **Workers AI: Read**                     |
| `DOCS_AI_MODEL`         | no       | Defaults to `@cf/openai/gpt-oss-120b`                      |
| `DOCS_AI_BASE_URL`      | no       | Any other OpenAI-compatible server, such as Ollama or Groq |

Without the first two, `/api/ask` answers `503` and the rest of the site is
unaffected. The free Workers AI allowance is 10,000 neurons a day, roughly 25
questions on gpt-oss-120b, so the route allows 10 questions per IP every 10
minutes and sends only the last 6 messages of a conversation. Those limits
keep each question cheap.

## Content rules

- Explain workflows in MDX; do not duplicate request or response schemas in prose.
- Add or update OpenAPI operations in the same change as a public API route.
- Add TSDoc to public SDK exports so the source-derived tables stay useful.
- Use `sk_` keys only in server examples and `pk_` keys only in browser examples.
- Keep architecture and implementation design records in the repository-level
  `docs/` directory. This application is the external integration surface.

## Visual system

The docs inherit the landing site's design language: white paper, near-black
ink, Mayarin green, Instrument Serif headings, Geist body copy, JetBrains
Mono code, and Clash Display only for the wordmark. Update the landing and docs
tokens together when the brand changes.
