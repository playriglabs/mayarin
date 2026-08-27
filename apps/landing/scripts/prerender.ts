import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { prerenderAll } from "../dist-ssr/entry-server.js";

const DIST = new URL("../dist/", import.meta.url).pathname;
const SSR_DIST = new URL("../dist-ssr/", import.meta.url).pathname;

const escapeAttribute = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Rewrite one `<meta>`'s content, whatever order or line breaks it was written in. */
function setMeta(html: string, attribute: string, name: string, value: string): string {
  const pattern = new RegExp(`(<meta[^>]*${attribute}="${name}"[^>]*content=")[^"]*(")`, "i");
  const swapped = html.replace(pattern, `$1${escapeAttribute(value)}$2`);
  if (swapped !== html) return swapped;

  // Prettier writes the content attribute before the name on some tags.
  const reversed = new RegExp(`(<meta[^>]*content=")[^"]*("[^>]*${attribute}="${name}")`, "i");
  return html.replace(reversed, `$1${escapeAttribute(value)}$2`);
}

/**
 * The last commit date, not the build date: a rebuild that changed nothing is
 * not a modification, and a lastmod Google learns to distrust is worse than no
 * lastmod at all.
 */
function lastModified(): string {
  try {
    return execFileSync("git", ["log", "-1", "--format=%cs"], { encoding: "utf8" }).trim();
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

const template = await readFile(join(DIST, "index.html"), "utf8");
const pages = prerenderAll();

for (const page of pages) {
  const { title, description, canonical } = page.route.meta;

  let html = template
    .replace(/<title>[^<]*<\/title>/i, `<title>${escapeAttribute(title)}</title>`)
    .replace('<div id="app"></div>', `<div id="app">${page.html}</div>`);

  html = setMeta(html, "name", "description", description);
  html = setMeta(html, "property", "og:title", title);
  html = setMeta(html, "property", "og:description", description);
  html = setMeta(html, "name", "twitter:title", title);
  html = setMeta(html, "name", "twitter:description", description);

  if (canonical) {
    html = html
      .replace(/(<link[^>]*rel="canonical"[^>]*href=")[^"]*(")/i, `$1${canonical}$2`)
      .replace(/(<meta[^>]*property="og:url"[^>]*content=")[^"]*(")/i, `$1${canonical}$2`);
  } else {
    // A page with no canonical is a page that should not be indexed at all.
    html = html.replace(
      /(<meta[^>]*name="robots"[^>]*content=")[^"]*(")/i,
      "$1noindex, nofollow$2",
    );
  }

  const target = join(DIST, page.file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, html);
  console.log(`prerendered ${page.file}`);
}

// The sitemap comes from the same route table as the pages, so a route can
// never be prerendered and left out of it. changefreq and priority are gone:
// Google ignores both, and they were the only thing in the file that could
// disagree with reality.
const lastmod = lastModified();
const indexable = pages.filter((page) => page.route.meta.canonical);
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${indexable
  .map(
    (page) =>
      `  <url>\n    <loc>${page.route.meta.canonical}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`,
  )
  .join("\n")}
</urlset>
`;

await writeFile(join(DIST, "sitemap.xml"), sitemap);
console.log(`sitemap.xml (${indexable.length} urls, lastmod ${lastmod})`);

await rm(SSR_DIST, { recursive: true, force: true });
