import { createMayarin, isMayarinApiError } from "@mayarin/sdk";
import {
  loadDemoConfig,
  parseCheckoutRequest,
  parseWebhookEvent,
  reusableOrNewCatalogLink,
} from "./index.ts";

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

const WEBHOOK_SIGNATURE_HEADER = "webhook-signature";
const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300;

async function verifyWorkerWebhook(options: {
  readonly header: string;
  readonly body: string;
  readonly secrets: readonly string[];
  readonly now: Date;
}): Promise<boolean> {
  let timestamp: number | undefined;
  const signatures: string[] = [];
  for (const part of options.header.split(",")) {
    const [key, value] = part.split("=", 2);
    if (key === "t" && value !== undefined) timestamp = Number(value);
    if (key === "v1" && value !== undefined) signatures.push(value);
  }
  if (
    timestamp === undefined ||
    !Number.isInteger(timestamp) ||
    signatures.length === 0 ||
    Math.abs(Math.floor(options.now.getTime() / 1_000) - timestamp) >
      WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS
  ) {
    return false;
  }

  const message = new TextEncoder().encode(`${timestamp}.${options.body}`);
  return Promise.all(
    options.secrets.map(async (secret) => {
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
      const expected = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      return signatures.includes(expected);
    }),
  ).then((matches) => matches.some(Boolean));
}

const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

const paymentIdFrom = (pathname: string): string | undefined =>
  /^\/api\/payment-status\/([^/]+)$/.exec(pathname)?.[1];

async function apiResponse(request: Request, env: WorkerEnv): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return undefined;

  try {
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
    const mayarin = createMayarin({ baseUrl: config.apiUrl, secretKey: config.secretKey });

    if (request.method === "GET" && url.pathname === "/api/products") {
      const products = await mayarin.commerce.products.list(config.merchant.id);
      return json({ products });
    }

    if (request.method === "POST" && url.pathname === "/api/checkout") {
      const checkout = parseCheckoutRequest(await request.json());
      if (checkout === undefined) {
        return json(
          { error: "Expected { lines: [{ productId, quantity: positive integer }] }" },
          400,
        );
      }
      const link = await reusableOrNewCatalogLink(mayarin, config, checkout);
      return json({ id: link.id, url: link.url });
    }

    if (request.method === "POST" && url.pathname === "/api/webhooks/mayarin") {
      if (config.webhookSecret === undefined) {
        return json({ error: "MAYARIN_WEBHOOK_SECRET is not configured" }, 503);
      }
      const rawBody = await request.text();
      const signature = request.headers.get(WEBHOOK_SIGNATURE_HEADER);
      if (
        signature === null ||
        !(await verifyWorkerWebhook({
          header: signature,
          body: rawBody,
          secrets: [config.webhookSecret],
          now: new Date(),
        }))
      ) {
        return json({ error: "Invalid webhook signature" }, 401);
      }
      const event = parseWebhookEvent(rawBody);
      if (event?.state === "SUCCESS") {
        const intent = await mayarin.payment.getIntent(event.paymentIntentId);
        if (intent.status !== "COMPLETED" || intent.merchant.id !== config.merchant.id) {
          return json({ error: "Payment does not belong to this merchant" }, 403);
        }
      }
      return json({ received: true }, 202);
    }

    const paymentId = paymentIdFrom(url.pathname);
    if (request.method === "GET" && paymentId !== undefined) {
      const intent = await mayarin.payment.getIntent(paymentId);
      // The intent is fetched every poll anyway, so the success page can show
      // what was paid without a second round-trip: the priced amount, the rail
      // the payer used, and when it settled.
      return json({
        referencePaymentId: paymentId,
        success: intent.merchant.id === config.merchant.id && intent.status === "COMPLETED",
        merchantName: intent.merchant.name,
        amount: intent.amount,
        payment: intent.payment,
        completedAt: intent.completedAt,
        merchantReference: intent.merchantReference,
      });
    }

    return json({ error: "Not found" }, 404);
  } catch (error: unknown) {
    if (isMayarinApiError(error)) {
      return json({ error: error.message }, error.status === 0 ? 502 : error.status);
    }
    console.error("[storefront] unexpected error", error);
    return json({ error: "An unexpected server error occurred. Please try again." }, 500);
  }
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return (await apiResponse(request, env)) ?? env.ASSETS.fetch(request);
  },
};
