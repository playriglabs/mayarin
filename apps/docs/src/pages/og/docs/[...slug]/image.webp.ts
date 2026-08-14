import type { APIRoute } from "astro";
import { render } from "takumi-js";
import { fromHtml } from "takumi-js/helpers/html";
import { source } from "@/lib/source";

// Renders an OpenGraph image per docs page. The URL is emitted by
// `getPageImageUrl` in src/lib/source.ts: `/og/docs/{slugs}/image.webp`.
// Stupid simple: white paper, Mayarin green mark, page title + description.

export const GET: APIRoute = async ({ params }) => {
  const slugs = typeof params.slug === "string" ? params.slug.split("/") : [];
  const page = source.getPage(slugs);
  const title = page?.data.title ?? "Mayarin Docs";
  const description = page?.data.description ?? "Build programmable crypto-commerce with Mayarin.";

  const markup = `
<div style="display:flex;flex-direction:column;justify-content:space-between;width:1200px;height:630px;padding:80px;background:#ffffff;color:#0a0a0a;font-family:Inter Tight,Helvetica,Arial,sans-serif;">
  <div style="display:flex;align-items:center;gap:20px;">
    <div style="width:28px;height:28px;border-radius:8px;background:#16a34a;"></div>
    <span style="font-size:28px;font-weight:600;letter-spacing:-0.01em;">Mayarin Docs</span>
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
