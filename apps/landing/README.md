# @mayarin/landing

Marketing site for Mayarin. Vite + Preact + Tailwind v4, no runtime dependency on the API.

```bash
bun run dev:landing      # http://localhost:4321
bun run build:landing    # static output in apps/landing/dist
bun run deploy:landing   # verify, build, and deploy to Cloudflare Pages
bun run --cwd apps/landing early-access:list # list early-access submissions
```

The deployment target is the `mayarin-landing` Cloudflare Pages project, as
recorded in `wrangler.jsonc`. Deployment is manual; the project is not connected
to GitHub. Wrangler requires Node.js 22 or newer for deployment.

Early-access submissions are stored in the bound
`mayarin-landing-early-access` D1 database. `deploy:landing` applies pending D1
migrations before uploading the site. The list command prints email and
submission time, newest first; it does not expose a public listing endpoint.

## Design system

Tokens live in `src/styles.css` under `@theme` — there are no design values in components
beyond layout utilities.

| Token            | Value     | Used for                                                         |
| ---------------- | --------- | ---------------------------------------------------------------- |
| `--color-paper`  | `#ffffff` | Light sections                                                   |
| `--color-void`   | `#050505` | Reserved for dark surfaces; the pitch deck uses it               |
| `--color-ink`    | `#111111` | Primary text                                                     |
| `--color-slate`  | `#666666` | Secondary text                                                   |
| `--color-line`   | `#eaeaea` | Hairlines on light                                               |
| `--color-accent` | `#0eeb2e` | Graphic accent, and buttons **on dark only**                     |
| `--color-forest` | `#1f6f54` | The accent where text or focus rings need AA contrast on white   |
| `--color-plate`  | `#0b2016` | Illustration plates on dark sections — forest pushed to the void |

`--color-accent` never carries text on white: at 1.6:1 it fails contrast. Accent green marks
nodes, rails and flow; `--color-forest` is its accessible counterpart for type.

Type uses HB Set through `--font-heading` for `h1`–`h3`, `--font-display` for display accents,
and `--font-brand` for the wordmark. `--font-sans` (Geist) handles everything read, while
`--font-mono` (Cascadia Code, then Geist Mono) handles labels and code — the mono weights are
imported latin-only, since the snippets are ASCII.

## Structure

`src/pages/landing.tsx` composes the landing page from `src/components/landing/`.
Styling is Tailwind utilities; the `--color-v2-*` tokens in `src/styles.css`
carry the illustration palette.

The hero reserves an empty dashboard frame. When the screenshot is ready, put it
in `public/images/` and pass its URL to `DashboardPreview` in
`src/components/landing/sections.tsx`, for example
`<DashboardPreview src="/images/dashboard.webp" />`.

- `src/components/landing/*` — one file per section, in the order
  `pages/landing.tsx` composes them, plus the primitives they share: `ui.tsx`
  (`Action`, `SectionIntro`, `DashboardPreview`, `Check`), `card-carousel.tsx`
  (the page-at-a-time track behind Use cases and Principles), `rail-mark.tsx`
  and `network-marks.tsx`.
- `src/components/*` — what more than one page uses: the footer and its
  wordmark, the `Globe`, the "Powered by" strip and its `LOGOS` list,
  `ScrambleText`, `use-case-content.tsx`, and `ui.tsx`, which is now only
  `ArrowRight`.
- `src/graphics/*` — `glyphs.tsx` (the principle marks), `grid-field.tsx` and
  `wave-grid.tsx` (pitch-deck backdrops).
- `src/data/capability-snippets.json` and `src/data/snippets.json` +
  `plugins/shiki-snippets.ts` — the code samples and the Vite plugin that
  highlights them. Shiki runs at build time behind a `virtual:code-snippets`
  module, which exports the two lists separately so adding a capability example
  cannot change what another surface renders. Shipping the highlighter to the
  browser would cost more than the rest of the page. The theme is the site
  palette expressed as TextMate scopes, so highlighting is grammar-accurate but
  still only ink, white and the accent. Line numbers come from a CSS counter, so
  copied source stays clean.
- `src/lib/early-access.ts` — one `useEarlyAccess` hook, so every form posting to
  `/api/early-access` shares a submission path.
- `src/lib/smooth-scroll.ts` — Lenis setup. It also routes in-page anchor clicks
  through `lenis.scrollTo` with a header offset; without that, `#hash` links jump
  instantly while wheel and touch glide, which reads as two different scrolls on
  one page. Disabled under `prefers-reduced-motion`, where the browser's own
  scrolling is left alone.

  A horizontally scrolling child carries `data-lenis-prevent-horizontal`, **not**
  `data-lenis-prevent`: the latter hands Lenis back every gesture over the
  element, so scrolling the page past a carousel drops out of the smoothed scroll
  and back into the browser's own.

- `src/pages/pitch-deck/*` — the pitch deck at `/pitch-deck`, `noindex`.
  `slides.tsx` mirrors `docs/pitch-deck.md` slide for slide; change the copy there
  first. The track is a horizontal scroll-snap row from `md` up (a long page
  below), each slide declares its own reveal, and some carry a backdrop from
  `graphics/` or the dark `Globe`. Keyboard: arrows, paging keys, Home/End, `F`
  fullscreen, `N` notes, `T` presenter timer, `R` timer reset; a vertical wheel
  turns one page. Lenis does not mount here — it would fight the snap.

## Logos

`public/images/logos/*.svg` holds the third-party marks the "Powered by" section renders. They are
downloaded originals — the one exception is `ethereum.svg`, whose `viewBox` is cropped to the
artwork because ethereum.org ships its lockup inside a mostly empty 1920x1080 canvas. Anything
added there also has to be added to `LOGOS` in `src/components/powered-by.tsx`.

Two flags on a `Logo` describe the file rather than the design, and both exist because a mark that
is invisible on white is not invisible on a dark plate:

- `tonal` — the mark carries meaningful light areas, either its own background (Pyth) or white
  cut-outs inside it (Arbitrum). Flattening every tone with `brightness-0` loses them and leaves a
  blob, so those invert, greyscale and `mix-blend-screen` instead.
- `light` — the artwork is drawn in white (Alchemy). Correct on the plate, invisible on the light
  strip, which inverts it back to ink before greying it.

`public/chains/*.svg` is separate: those are the round network marks `chainLogoUrl` serves for
chains Trust Wallet's CDN does not carry.

## Motion

Sections do not animate in. What moves is deliberate and small.

`components/landing/payment-orbits.tsx` is the hero's backdrop: three dashed
orbits carrying the five currencies a merchant can price in, each disc following
its path with native SVG `animateMotion` so it stays upright. The symbols come
from `assetSymbol` in `@mayarin/shared`, so the hero cannot advertise a currency
the registry does not carry. The whole SVG pauses when it scrolls out of view,
when the tab is hidden, and under `prefers-reduced-motion`, which instead places
each disc at a fixed point on its orbit.

`components/landing/scroll-tilt.tsx` flattens the dashboard frame from a
rotated plate to face-on as it enters. It measures a stationary wrapper rather
than the panel it transforms, so the transform cannot feed back into the scroll
progress that drives it.

The capability cards cross-fade their illustration out and a code panel in on
hover and on keyboard focus. Both layers are promoted with `transform-gpu` and
`will-change`, so the transition composites instead of re-rasterising the Shiki
subtree every frame; clicking opens the full snippet in a `<dialog>`, which
brings Escape, the focus trap and the inert page behind it for free.

The `Globe` is `cobe` on a canvas. It holds off creating its WebGL context until
the section is near, and stops drawing once it leaves. City labels are projected
with the same maths cobe uses internally, so a label cannot drift off its marker,
and overlapping ones are culled per frame.

All of it is disabled under `prefers-reduced-motion`.
