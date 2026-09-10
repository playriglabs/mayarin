/**
 * The Cloudflare Worker that serves the deployed storefront.
 *
 * The API routes come from `server/api.ts` unchanged — this file only wires
 * the environment in and serves static assets for everything the API declines.
 */

import { type DemoConfig, demoRoutes, loadDemoConfig } from "./api.ts";

interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

interface WorkerEnv {
  readonly ASSETS: AssetFetcher;
  readonly MAYARIN_API_URL?: string;
  readonly MAYARIN_SECRET_KEY?: string;
  readonly MAYARIN_MERCHANT_ID?: string;
  readonly MAYARIN_MERCHANT_NAME?: string;
  readonly MAYARIN_MERCHANT_CITY?: string;
  readonly MAYARIN_MERCHANT_COUNTRY?: string;
  readonly MAYARIN_WEBHOOK_SECRET?: string;
  readonly DEMO_PUBLIC_URL?: string;
}

/**
 * The storefront is a single-page app with real paths (`/history`,
 * `/checkout/shipping`). With `_worker.js` mounted there is no automatic
 * SPA fallback, so a deep link that matches no asset serves index.html.
 */
async function assetsResponse(request: Request, env: WorkerEnv): Promise<Response> {
  const assets = await env.ASSETS.fetch(request);
  if (assets.status !== 404 || request.method !== "GET") return assets;
  const url = new URL(request.url);
  if (url.pathname.includes(".")) return assets;
  const index = await env.ASSETS.fetch(new Request(new URL("/", url)));
  return index.status === 200
    ? new Response(index.body, { status: 200, headers: index.headers })
    : assets;
}

/**
 * Built once per isolate, so the in-memory record of verified payments
 * survives between a webhook and the success page that polls after it.
 */
let cached:
  | { readonly config: DemoConfig; readonly routes: ReturnType<typeof demoRoutes> }
  | undefined;

function routesFor(env: WorkerEnv): ReturnType<typeof demoRoutes> {
  const config = loadDemoConfig({
    MAYARIN_API_URL: env.MAYARIN_API_URL,
    MAYARIN_SECRET_KEY: env.MAYARIN_SECRET_KEY,
    MAYARIN_MERCHANT_ID: env.MAYARIN_MERCHANT_ID,
    MAYARIN_MERCHANT_NAME: env.MAYARIN_MERCHANT_NAME,
    MAYARIN_MERCHANT_CITY: env.MAYARIN_MERCHANT_CITY,
    MAYARIN_MERCHANT_COUNTRY: env.MAYARIN_MERCHANT_COUNTRY,
    MAYARIN_WEBHOOK_SECRET: env.MAYARIN_WEBHOOK_SECRET,
    DEMO_PUBLIC_URL: env.DEMO_PUBLIC_URL,
  });
  if (cached === undefined || cached.config.secretKey !== config.secretKey) {
    cached = { config, routes: demoRoutes(config) };
  }
  return cached.routes;
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    if (new URL(request.url).pathname.startsWith("/api/")) {
      try {
        return (await routesFor(env)(request)) ?? (await assetsResponse(request, env));
      } catch (error: unknown) {
        // Only a configuration failure reaches here — the routes map their own
        // API errors — so it is worth saying which variable is missing.
        console.error("[storefront] configuration error", error);
        return Response.json(
          { error: error instanceof Error ? error.message : "The demo is not configured" },
          { status: 503, headers: { "cache-control": "no-store" } },
        );
      }
    }
    return assetsResponse(request, env);
  },
};
