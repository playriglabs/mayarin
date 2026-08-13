import { verifyWebhook, WEBHOOK_SIGNATURE_HEADER } from "@mayarin/notifications";
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

const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

const paymentIdFrom = (pathname: string): string | undefined =>
  /^\/api\/payment-status\/([^/]+)$/.exec(pathname)?.[1];

async function apiResponse(request: Request, env: WorkerEnv): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return undefined;

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

  try {
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
        !verifyWebhook({
          header: signature,
          body: rawBody,
          secrets: [config.webhookSecret],
          now: new Date(),
        })
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
      return json({
        referencePaymentId: paymentId,
        success: intent.merchant.id === config.merchant.id && intent.status === "COMPLETED",
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
