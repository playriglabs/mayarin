# @mayarin/checkout-ui

The buyer-facing pages (#151): the hosted checkout link page, the payment page,
and the invoice view. One Vite + React SPA, served by the payment API.

## How it renders

There is no client-side router and no data fetch on load. The API decides which
page a URL is and injects that decision into the built shell as a
`window.__BOOTSTRAP__` payload (`apps/api/src/services/checkout-shell.ts`). The
SPA renders the payload. Navigation between pages is a full page load, which
hands the next URL back to the API.

The contract lives in two places, mirrored by hand:

- `src/types.ts` — what each page consumes.
- `apps/api/src/routes/checkout-page.ts` and `invoice-page.ts` — what the API
  builds. The API's endpoint tests pin the shape.

## Build shape

The bundle is one JS chunk and one CSS file, on purpose (`vite.config.ts`). The
API ships the bundle inside its own image, so a deploy replaces the hashed
assets — a payer holding an old page open must never request a chunk that no
longer exists. Do not add a dynamic import.

The API serves the assets at `/checkout-ui/*`, which is the Vite `base`.

## Commands

```bash
bun run --cwd apps/checkout-ui build     # write dist/, which the API reads
bun run --cwd apps/checkout-ui dev      # vite build --watch, for live editing
bun run dev:all                          # includes this watch task
bun test apps/checkout-ui                # logic + render tests, no browser
```

The API reads `dist/index.html` per request, so the watch task is enough — no
dev server, no proxy. A missing build is a clear 500 with the build command in
the message. Tests in `apps/api` use a fixture shell and never need a build.
