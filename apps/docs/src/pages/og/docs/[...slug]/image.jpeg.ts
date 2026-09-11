// Every asset the card needs is inlined as base64 at build time, so rendering
// makes no network call at all. That is not an optimisation — it is the whole
// failure mode. This endpoint used to fetch its artwork over HTTP, and a fetch
// that failed threw, and a throw here does not surface as a 500: Astro rewrites
// to the 404 page, so `og:image` answered `404 text/html` and every social
// card silently broke. Nothing to fetch, nothing to fail.

import geistUrl from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?inline";
import { Renderer } from "@takumi-rs/core";
import type { APIRoute } from "astro";
import { render } from "takumi-js";
import { fromHtml } from "takumi-js/helpers/html";
import { source } from "@/lib/source";
import hbSetUrl from "../../../../../../landing/public/fonts/HBSetv0.96-Light.woff2?inline";
import backgroundUrl from "../../../../../../landing/public/og-dynamic.jpeg?inline";

// Renders an OpenGraph image per docs page. The URL is emitted by
// `getPageImageUrl` in src/lib/source.ts: `/og/docs/{slugs}/image.jpeg`.
//
// The artwork is the landing site's shared OG plate, bundled from its source
// rather than read off `mayarin.xyz`, so a docs card and a mayarin.xyz card are
// the same picture and neither waits on the other being deployed.
//
// The plate already carries the wordmark, top left, and nothing here redraws
// it — which is also why there is no scrim over the artwork: anything opaque
// enough to help the text would wash the wordmark out. The plate's left half is
// near-white on its own, so dark text needs no help there.

// The plate's green globe fills its right half, so the title is bounded by this
// column rather than by the canvas. Bottom-anchored, with the footer set
// directly beneath it, so a one-line card and a three-line card share the same
// baseline instead of drifting around the middle.
const TEXT_COLUMN = 620;

// The card carries the page title and nothing else, so the ceiling is what
// still fits the column at this size. Verified against every real page: the
// longest title in the docs today is 51 characters, and three lines still clear
// the plate's own wordmark.
const TITLE_LIMIT = 54;

// The text hangs off the plate's own wordmark, not off the canvas: the mark's
// leftmost ink sits at x=62, and both faces carry about 3px of left side
// bearing at these sizes, so a box at 59 puts the title's stem and the footer's
// first letter on the wordmark's edge. Measured off a render, not guessed —
// the 80px it replaced left both lines visibly inset from the mark above them.
const TEXT_INSET = 59;

export const GET: APIRoute = async ({ params }) => {
  const slugs = typeof params.slug === "string" ? params.slug.split("/") : [];
  const page = source.getPage(slugs);
  const title = truncate(page?.data.title ?? "Mayarin Docs", TITLE_LIMIT);

  // The plate is an absolutely positioned layer rather than a CSS
  // `background-image`. Takumi resolves a `background-image: url(...)` only for
  // an http(s) source it can fetch — handed a `data:` URI it paints nothing and
  // reports no error, which reads exactly like a broken asset. An `<img>` takes
  // the same URI and draws it.
  //
  // The root is pinned to the canvas origin and the markup is trimmed for the
  // same reason: production rendered this tree 21px down the canvas — a
  // transparent strip along the top and the plate's bottom 21px cut off —
  // where the identical markup renders flush here on both the native and the
  // wasm backend. A root that states its own origin cannot be placed after
  // anything, and a string with no leading newline gives the HTML parser no
  // stray text node to lay out before it.
  const markup =
    `<div style="display:flex;position:absolute;top:0;left:0;width:1200px;height:630px;background-color:#ffffff;color:#0a0a0a;font-family:HB Set,Helvetica,Arial,sans-serif;">
  <img src="${backgroundUrl}" alt="" style="position:absolute;top:0;left:0;width:1200px;height:630px;" />
  <div style="display:flex;flex-direction:column;justify-content:flex-end;width:1200px;height:630px;padding:72px 80px 72px ${TEXT_INSET}px;">
    <div style="display:flex;flex-direction:column;gap:26px;flex-shrink:0;">
      <div style="display:flex;font-size:76px;font-weight:300;line-height:1.04;letter-spacing:-0.035em;max-width:${TEXT_COLUMN}px;word-break:break-word;overflow:hidden;">${escapeHtml(title)}</div>
      <div style="display:flex;font-family:Geist Variable,sans-serif;font-size:21px;color:#64748b;">docs.mayarin.xyz</div>
    </div>
  </div>
</div>`.trim();

  const { node } = fromHtml(markup);
  const image = await render(node, {
    width: 1200,
    height: 630,
    // JPEG, not WebP. Facebook, Instagram and WhatsApp refuse a WebP
    // `og:image` outright — the card falls back to the site icon, which is what
    // a share looked like before this — while a browser-based preview tool
    // renders it fine, so the format is the one thing that looks innocent.
    // JPEG is what every crawler accepts, and the plate is a photograph-like
    // gradient, which is what JPEG is for.
    format: "jpeg",
    // 88 keeps the wordmark's edges clean on the plate's flat left half; the
    // card lands around 120KB, well inside every crawler's ceiling.
    quality: 88,
    renderer: await brandRenderer(),
  });

  return new Response(image, {
    headers: {
      "content-type": "image/jpeg",
      "cache-control": "public, max-age=86400, immutable",
    },
  });
};

/**
 * The renderer, built once per process with the brand's two faces.
 *
 * HB Set is the landing site's heading face and carries the title; Geist is its
 * body face and carries the one line of body text on the card. Registering only
 * these two is also what makes the fallback safe: with no face for a family,
 * the renderer reaches for whichever it does have.
 */
let renderering: Promise<Renderer> | undefined;

function brandRenderer(): Promise<Renderer> {
  renderering ??= (async () => {
    const renderer = new Renderer();
    await renderer.registerFont({ name: "HB Set", data: decodeDataUri(hbSetUrl), weight: 300 });
    await renderer.registerFont({
      name: "Geist Variable",
      data: decodeDataUri(geistUrl),
      generic: "sans-serif",
    });
    return renderer;
  })();
  return renderering;
}

/** Turns a build-time inlined `data:` asset back into the bytes it encodes. */
function decodeDataUri(uri: string): Uint8Array {
  const base64 = uri.slice(uri.indexOf(",") + 1);
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

/**
 * Trims to a whole word inside `limit`, so a card never crops mid-word.
 *
 * Trailing punctuation goes with it: a title cut at its own comma would
 * otherwise read `Currencies, assets,…`.
 */
function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const clipped = value.slice(0, limit);
  const lastSpace = clipped.lastIndexOf(" ");
  const kept = lastSpace > limit * 0.6 ? clipped.slice(0, lastSpace) : clipped;
  return `${kept.replace(/[\s.,;:—–-]+$/u, "")}…`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
