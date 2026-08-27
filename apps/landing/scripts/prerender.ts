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

await rm(SSR_DIST, { recursive: true, force: true });
