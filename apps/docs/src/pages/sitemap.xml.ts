/**
 * The docs sitemap.
 *
 * Built from the same `source` the routes are, so a page cannot exist in the
 * navigation and be missing here. Until this route existed, `robots.txt` on
 * this host pointed at `mayarin.xyz/sitemap.xml` — a two-URL file listing the
 * landing site, which named none of these pages.
 */

import type { APIRoute } from "astro";
import { source } from "@/lib/source";

const SITE = "https://docs.mayarin.xyz";

export const GET: APIRoute = ({ site }) => {
  const origin = (site ?? new URL(SITE)).origin;
  const urls = source
    .getPages()
    .map((page) => `${origin}${page.url}`)
    .sort();

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url>\n    <loc>${escapeXml(url)}</loc>\n  </url>`).join("\n")}
</urlset>
`;

  return new Response(body, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
