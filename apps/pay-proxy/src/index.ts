/**
 * The `pay-testnet.mayarin.xyz` reverse proxy (RFC #163).
 *
 * A buyer-facing origin for the hosted checkout. The SPA and its pages stay
 * served by `core-api` on `api-testnet.mayarin.xyz`; this Worker forwards only
 * the buyer path allowlist (`allowlist.ts`) and answers 404 for everything
 * else, so the full `/v1/*` API surface is not exposed on the pay host.
 *
 * The SPA issues relative `/v1/*` calls, so forwarding them same-origin is what
 * lets it run unmodified. The Worker stamps `x-forwarded-host` /
 * `x-forwarded-proto` with the inbound values so `core-api` builds a
 * same-origin bootstrap `statusUrl` (see `requestOrigin` in
 * `apps/api/src/services/checkout-shell.ts`).
 *
 * SSE on `/checkout/events/:id` streams: the origin `Response` is returned
 * directly, never buffered.
 */

import { allowed } from "./allowlist.ts";

interface Env {
  ORIGIN: string;
}

/** Hop-by-hop and request-context headers not forwarded to the origin. */
const STRIP_HEADERS = new Set([
  "host",
  "cf-connecting-ip",
  "cf-ipcountry",
  "cf-ray",
  "cf-visitor",
  "cf-worker",
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-forwarded-host",
  "x-real-ip",
]);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (!allowed(request.method, url.pathname)) {
      return new Response("Not found", { status: 404 });
    }

    const origin = env.ORIGIN.replace(/\/+$/, "");
    const target = new URL(`${origin}${url.pathname}${url.search}`);

    const headers = new Headers();
    for (const [name, value] of request.headers) {
      if (!STRIP_HEADERS.has(name.toLowerCase())) headers.set(name, value);
    }
    // The origin builds the bootstrap `statusUrl` from this, so the pay page
    // polls its own host rather than the API host behind the proxy.
    headers.set("x-forwarded-host", url.hostname);
    headers.set("x-forwarded-proto", url.protocol.replace(":", ""));

    const response = await fetch(target, {
      method: request.method,
      headers,
      body: request.body,
      redirect: "manual",
    });

    return response;
  },
} satisfies ExportedHandler<Env>;
