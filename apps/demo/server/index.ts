/**
 * The Vite-dev adapter for the demo API.
 *
 * The handlers live in `server/api.ts` against the Fetch API; this file is
 * only the connect-middleware shim Vite needs, so the dev server and the
 * deployed Worker run identical route code.
 */

import { Buffer } from "node:buffer";
import type { IncomingMessage, ServerResponse } from "node:http";
import { type DemoConfig, demoRoutes } from "./api.ts";

export {
  type CheckoutRequest,
  cartCheckoutBody,
  DEMO_CURRENCY,
  type DemoConfig,
  demoRoutes,
  hostedPaymentUrl,
  loadDemoConfig,
  parseCheckoutRequest,
  parseWebhookEvent,
} from "./api.ts";

type NextHandleFunction = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void,
) => void;

/**
 * The body as the exact text that was sent. A webhook signature covers those
 * bytes, so the shim must not re-encode or re-serialise them on the way in.
 */
async function readBody(req: IncomingMessage): Promise<string | undefined> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Rebuilds the incoming request as a `Request` the shared routes can read. */
async function toRequest(req: IncomingMessage, mountedAt: string): Promise<Request> {
  const url = new URL(`${mountedAt}${req.url ?? "/"}`, "http://localhost");
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value)) for (const entry of value) headers.append(name, entry);
  }
  const body = await readBody(req);
  return new Request(url, {
    method: req.method ?? "GET",
    headers,
    ...(body === undefined || body === "" ? {} : { body }),
  });
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  for (const [name, value] of response.headers) res.setHeader(name, value);
  res.end(Buffer.from(await response.arrayBuffer()));
}

/**
 * The demo API as connect middleware, mounted at `/api` — so `req.url` arrives
 * with the prefix stripped and this shim puts it back before routing.
 */
export function demoApi(config: DemoConfig): NextHandleFunction {
  const routes = demoRoutes(config);

  return (req, res, next) => {
    void (async () => {
      const response = await routes(await toRequest(req, "/api"));
      if (response === undefined) {
        next();
        return;
      }
      await send(res, response);
    })().catch(next);
  };
}
