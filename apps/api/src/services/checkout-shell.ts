/**
 * The checkout UI shell (#151).
 *
 * The buyer-facing pages are a Vite-built SPA (`apps/checkout-ui`), and this is
 * the seam that serves it: the page routes read the built `index.html`, replace
 * its placeholder with a `window.__BOOTSTRAP__` payload, and answer with the
 * result — so the page paints from data it already has, with no fetch and no
 * spinner. The API stays the only origin; the bundle ships inside its image.
 */

import { join, normalize } from "node:path";
import { ConfigurationError, NotFoundError } from "@mayarin/shared";
import { Hono } from "hono";
import type { Container } from "../container.ts";

/** What the shell's `<head>` carries in place of this exact comment. */
const PLACEHOLDER = "<!--__BOOTSTRAP__-->";

/** Where the per-document Open Graph meta tags are injected (#165). */
const OG_PLACEHOLDER = "<!--__OG__-->";

/**
 * The origin the bootstrap `statusUrl` and invoice `checkoutUrl` resolve to.
 *
 * A deployment serves checkout on more than one host: the API origin
 * (`api-testnet.mayarin.xyz`) and a buyer-facing proxy (`pay-testnet.mayarin.xyz`,
 * RFC #163). The SPA polls `statusUrl` same-origin, so it must be the host the
 * page loaded from — not a single configured origin.
 *
 * The proxy stamps `x-forwarded-host` / `x-forwarded-proto` with the inbound
 * values; a direct request to the API origin carries neither, and falls back to
 * `publicBaseUrl` (the deployment's declared origin). Raw `host` is never read:
 * it can be an internal Railway hostname, and `publicBaseUrl` is the truer
 * answer for a non-proxied request.
 */
export function requestOrigin(
  header: (name: string) => string | undefined,
  fallbackPublicBaseUrl: string,
): string {
  const forwardedHost = header("x-forwarded-host");
  if (forwardedHost === undefined || forwardedHost === "") return fallbackPublicBaseUrl;
  const proto = header("x-forwarded-proto") ?? "https";
  return `${proto}://${forwardedHost}`;
}

/**
 * Serializes a bootstrap for a `<script>` element.
 *
 * Merchant names, titles and buyer details are attacker-controlled as far as
 * these pages are concerned — a merchant account is created by whoever signs
 * up. Escaping `<` keeps a value like `</script><script>…` inert: inside a JSON
 * string, `<` is the same character, but the HTML parser never sees a tag.
 */
export function bootstrapScript(bootstrap: object): string {
  const json = JSON.stringify(bootstrap)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `<script>window.__BOOTSTRAP__ = ${json}</script>`;
}

/**
 * Reads the shell and injects the bootstrap and the Open Graph meta tags.
 *
 * Read per request rather than cached: `vite build --watch` rewrites the file
 * (with new hashed asset names) during development, and one small file read is
 * nothing next to the database work every page here already does.
 *
 * `ogMeta` is the full `<meta>` block for the document (built by `og-image.ts`),
 * so a shared link renders its own preview card (#165) instead of the generic
 * landing image.
 */
export async function renderShell(
  distDir: string,
  bootstrap: object,
  ogMeta: string,
): Promise<string> {
  const shell = Bun.file(join(distDir, "index.html"));
  if (!(await shell.exists())) {
    throw new ConfigurationError(
      "The checkout UI is not built. Run: bun run --cwd apps/checkout-ui build",
      { distDir },
    );
  }
  const html = await shell.text();
  if (!html.includes(PLACEHOLDER)) {
    throw new ConfigurationError(
      `The checkout UI shell has no ${PLACEHOLDER} placeholder to inject into`,
      { distDir },
    );
  }
  if (!html.includes(OG_PLACEHOLDER)) {
    throw new ConfigurationError(
      `The checkout UI shell has no ${OG_PLACEHOLDER} placeholder to inject into`,
      { distDir },
    );
  }
  return html.replace(OG_PLACEHOLDER, ogMeta).replace(PLACEHOLDER, bootstrapScript(bootstrap));
}

/**
 * The static side of the shell: hashed assets and the favicon, mounted at
 * `/checkout-ui` to match the SPA's Vite `base`. Hashed files never change
 * content under the same name, so they cache as immutable.
 */
export function checkoutUiRoutes(container: Container): Hono {
  const distDir = container.config.checkoutUiDist;
  const app = new Hono();

  app.get("/favicon.svg", async (c) => {
    const file = Bun.file(join(distDir, "favicon.svg"));
    if (!(await file.exists())) throw new NotFoundError("No favicon", {});
    return c.body(await file.arrayBuffer(), 200, {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=3600",
    });
  });

  app.get("/assets/:name", async (c) => {
    const name = c.req.param("name");
    // One flat directory of hashed files. Anything that could walk out of it —
    // a separator or a dot-segment — is not a name Vite ever emits.
    if (name.includes("/") || name.includes("\\") || name.includes("..")) {
      throw new NotFoundError("No such asset", {});
    }
    const path = normalize(join(distDir, "assets", name));
    const file = Bun.file(path);
    if (!(await file.exists())) throw new NotFoundError("No such asset", {});
    const type = name.endsWith(".css")
      ? "text/css; charset=utf-8"
      : name.endsWith(".js")
        ? "text/javascript; charset=utf-8"
        : (file.type ?? "application/octet-stream");
    return c.body(await file.arrayBuffer(), 200, {
      "Content-Type": type,
      "Cache-Control": "public, max-age=31536000, immutable",
    });
  });

  return app;
}
