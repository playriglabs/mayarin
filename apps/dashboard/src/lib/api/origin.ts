/**
 * Absolute base URL of the dashboard API, for SERVER-side fetches only
 * (middleware, SSR, the `/api/*` proxy). A relative `/api` only resolves in
 * the browser, so the server needs an absolute origin.
 *
 * Kept apart from `client.ts` on purpose: browser islands import that module,
 * and `astro:env/server` must never reach the browser bundle.
 *
 * Resolution order:
 *   1. Worker runtime var  (`API_URL` in wrangler.jsonc `vars`)
 *   2. Build-time env      (`import.meta.env.DASHBOARD_API_URL`)
 *   3. Dev fallback        (dashboard API on :3001)
 *
 * `API_URL` is read through `getSecret`, which the Cloudflare adapter backs with
 * the Worker's env. `Astro.locals.runtime.env` was removed in Astro 6 and throws
 * on access — every `/api/*` call answered 500 and every session check failed.
 *
 * The configured value is an origin. `getApiBase` appends the dashboard API's
 * breaking-version boundary so SSR and browser requests target the same
 * contract.
 */

import { getSecret } from "astro:env/server";

export function getApiOrigin(): string {
  // The Cloudflare adapter exposes `wrangler.jsonc` bindings during local Astro
  // dev too. That file names the deployed testnet API, but a local login issues
  // a session in the local dashboard API. Verifying that cookie against testnet
  // makes a successful login bounce straight back to `/login`. Development is
  // one local stack; runtime bindings only outrank build config in production.
  if (import.meta.env.DEV) {
    return (
      (import.meta.env.DASHBOARD_API_URL as string | undefined) ?? "http://localhost:3001"
    ).replace(/\/+$/, "");
  }

  return (
    getSecret("API_URL") ??
    (import.meta.env.DASHBOARD_API_URL as string | undefined) ??
    "http://localhost:3001"
  ).replace(/\/+$/, "");
}

export function getApiBase(): string {
  return `${getApiOrigin()}/v1`;
}
