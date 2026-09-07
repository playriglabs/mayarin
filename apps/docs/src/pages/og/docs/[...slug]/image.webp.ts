import type { APIRoute } from "astro";
import { render } from "takumi-js";
import { fromHtml } from "takumi-js/helpers/html";
// Inlined as a base64 data URI at build time (Vite `?inline`), so the renderer
// needs no filesystem or network access — safe on the Cloudflare runtime.

import { source } from "@/lib/source";

// Renders an OpenGraph image per docs page. The URL is emitted by
// `getPageImageUrl` in src/lib/source.ts: `/og/docs/{slugs}/image.webp`.
// Stupid simple: white paper, the Mayarin full wordmark, page title +
// description. White background → black wordmark.

const BRAND_KIT_URL = "https://mayarin.xyz/brand-kit";

export const GET: APIRoute = async ({ params }) => {
  const slugs = typeof params.slug === "string" ? params.slug.split("/") : [];
  const page = source.getPage(slugs);
  const title = page?.data.title ?? "Mayarin Docs";
  const description = page?.data.description ?? "Build programmable clearing with Mayarin.";

  const markup = `
<div style="display:flex;flex-direction:column;justify-content:space-between;width:1200px;height:630px;padding:80px;background:#ffffff;color:#0a0a0a;font-family:Geist Variable,Helvetica,Arial,sans-serif;">
  <div style="display:flex;align-items:center;gap:2px;">
    <img src="${BRAND_KIT_URL}/mayarin-logo-black.svg" alt="" style="height:52px;width:52px;object-fit:contain;" />
    <span style="font-size:40px;font-weight:500;letter-spacing:-0.06em;line-height:1;">mayarin</span>
  </div>
  <div style="display:flex;flex-direction:column;gap:24px;">
    <div style="font-size:64px;font-weight:700;line-height:1.1;letter-spacing:-0.02em;max-width:1000px;">${escapeHtml(title)}</div>
    <div style="font-size:30px;line-height:1.4;color:#525252;max-width:980px;">${escapeHtml(description)}</div>
  </div>
  <div style="font-size:24px;color:#737373;">docs.mayarin.xyz</div>
</div>`;

  const { node } = fromHtml(markup);
  const image = await render(node, { width: 1200, height: 630, format: "webp" });

  return new Response(image, {
    headers: {
      "content-type": "image/webp",
      "cache-control": "public, max-age=86400, immutable",
    },
  });
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
