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
| `--color-void`   | `#050505` | Dark sections (how it works, developer experience, final CTA)    |
| `--color-ink`    | `#111111` | Primary text                                                     |
| `--color-slate`  | `#666666` | Secondary text                                                   |
| `--color-line`   | `#eaeaea` | Hairlines on light                                               |
| `--color-accent` | `#0eeb2e` | Graphic accent, and buttons **on dark only**                     |
| `--color-forest` | `#1f6f54` | The accent where text or focus rings need AA contrast on white   |
| `--color-plate`  | `#0b2016` | Illustration plates on dark sections — forest pushed to the void |

`--color-accent` never carries text on white: at 1.6:1 it fails contrast. Accent green marks
nodes, rails and flow; `--color-forest` is its accessible counterpart for type.

Type is a trio: `--font-display` (Instrument Serif) for headlines, `--font-sans` (Geist) for
everything read, and `--font-mono` (Geist Mono) for labels and code. `--font-brand` uses the
display face for the wordmark.

## Structure

- `src/sections/*` — one file per page section, in the order `app.tsx` composes them.
- `src/graphics/*` — `wave-grid.tsx` (the hero canvas), `topology.tsx` (the routing
  illustration, wide and compact variants), `stage-scene.tsx` (one isometric scene per clearing stage)
  and `glyphs.tsx` (the capability marks).
- `src/data/snippets.json` + `plugins/shiki-snippets.ts` — the code samples and the Vite plugin
  that highlights them. Shiki runs at build time behind a `virtual:code-snippets` module; shipping
  the highlighter to the browser would cost more than the rest of the page. The theme is the site
  palette expressed as TextMate scopes, so highlighting is grammar-accurate but still only ink,
  white and the accent. Line numbers come from a CSS counter, so copied source stays clean.
- `src/lib/smooth-scroll.ts` — Lenis setup. It also routes in-page anchor clicks through
  `lenis.scrollTo` with a header offset; without that, `#hash` links jump instantly while wheel and
  touch glide, which reads as two different scrolls on one page. Disabled under
  `prefers-reduced-motion`, where the browser's own scrolling is left alone.
- `src/components/*` — `ui.tsx` holds `Section`/`Label`/`SectionHeading`/`Lede`/`Button`, which is
  what keeps the vertical rhythm consistent; `reveal.tsx` is the one motion primitive.
- `src/pages/pitch-deck/*` — the pitch deck at `/pitch-deck`, `noindex`. `slides.tsx` mirrors
  `docs/pitch-deck.md` slide for slide; change the copy there first. The track is a horizontal
  scroll-snap row from `md` up (a long page below), each slide declares its own reveal — the
  headline and bullets stay put, the visual moves in the way that fits it — and some slides carry
  a backdrop from `graphics/` (grid field, wave plane) or the dark `Globe`. Keyboard: arrows,
  paging keys, Home/End, `F` fullscreen, `N` notes, `T` presenter timer, `R` timer reset; a
  vertical wheel turns one page. Lenis does not mount here — it would fight the snap.

## Logos

`public/images/logos/*.svg` holds the third-party marks the "Powered by" strip renders — chains
(Tempo, Base, Arbitrum, Polygon) and infrastructure (Alchemy, viem). They are downloaded
originals, unmodified; the strip greys them with a CSS filter rather than editing the files, so
replacing one is a drop-in. Anything added there also has to be added to `LOGOS` in
`src/components/powered-by.tsx`.

From `md` up the strip is a marquee: the list is rendered four times inside a track that
translates `-50%`, so the first half always overflows the widest viewport and the loop has no
seam. It pauses on hover. Below `md` the marquee is not rendered at all — phones get the static
wrapped list, which is also the copy screen readers see.

## Motion

Everything is a fade-and-rise on first viewport entry (`Reveal`), plus the hero wave grid and two
looping accents.

`graphics/wave-grid.tsx` is a canvas: a grid plane in perspective with a wave running through it.
Rows and columns are drawn as polylines rather than points, so it reads as one surface; spread,
height, wave amplitude and line weight all scale with depth, which is what sells the recession. An
accent crest sweeps from the horizon to the front every nine seconds — the one green thing in the
hero. Phones get a coarser mesh (30x20 instead of 56x30) for the same picture at a third of the
path work. Two intersected masks fade it at the horizon and at the edges of the frame; the type
sits far enough above it in contrast to need no clearing. Under `prefers-reduced-motion` it draws
one frame and stops.

The "How Mayarin works" section is a walkthrough rather than a list: six stages as a tablist that
drives a detail panel carrying the clearing-engine states each stage passes through. It
auto-advances every 6.5s, but only while the walkthrough is actually on screen, and stops for good
the moment someone hovers, clicks or arrows through it. The dwell timer is drawn as the hairline
filling under the active row. Below `md` there is no autoplay at all — the six stages are simply
unrolled as a stack of the same posters.

Each stage is a poster: a `--color-plate` panel carrying an isometric scene, then the copy on
near-black below it, hairline-bordered so it reads as a card without breaking the dark section. The scenes (`graphics/stage-scene.tsx`) are built from one 2:1 isometric grid — a shared
`iso()` projection, hatched extruded blocks, dotted ground planes — with the accent reserved for
what the stage is about: the intent leaving the application, the newest version of the aggregate,
two inputs collapsing into one settlement asset, debit and credit mirrored across the ledger,
the provider's answer coming back, the rail the merchant is finally paid on.

`stageScenes` holds factories, not elements: the same scene renders in the desktop panel and the
mobile stack at once, and a shared Preact vnode cannot be mounted twice.

Stage order there follows the engine, not the marketing diagram: clearing precedes settlement,
because the state machine is `CLEARING → SETTLING → SETTLED`.

The rest: the flow pulse on the routing illustration and the clearing-node pulse. All animation is disabled
under `prefers-reduced-motion`.
