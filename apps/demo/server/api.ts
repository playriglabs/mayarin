/**
 * The thin server behind the demo marketplace (#137).
 *
 * A merchant storefront never ships its secret key to the browser, so the
 * calls that need one — list the catalog, check a cart out, read a payment —
 * run here. The routes are written against the Fetch API so the Vite dev
 * middleware (`server/index.ts`) and the Cloudflare Worker (`server/worker.ts`)
 * run the same handlers rather than two copies that drift.
 *
 * Checkout is order-native: one cart checkout mints one Payment Intent per
 * order, carrying the storefront's own order id as `merchantReference`. The
 * shipping address stays on the buyer's device — Mayarin clears the payment,
 * the storefront owns the fulfilment record.
 */

import type { CheckoutCartBody } from "@mayarin/api/dto";
import {
  constructWebhook,
  createMayarin,
  isMayarinApiError,
  MayarinWebhookError,
} from "@mayarin/sdk";

/** The one currency the demo prices in. The point of #137 is the IDR-native flow. */
export const DEMO_CURRENCY = "IDR";
const WEBHOOK_SIGNATURE_HEADER = "webhook-signature";

export interface DemoConfig {
  readonly apiUrl: string;
  readonly merchant: {
    readonly id: string;
    readonly name: string;
    readonly city: string;
    readonly countryCode: string;
  };
  readonly secretKey: string;
  readonly publicUrl: string;
  readonly webhookSecret?: string;
}

/**
 * Reads the demo configuration, or throws naming every missing variable — a
 * demo that silently checks nothing out is worse than one that says why.
 */
export function loadDemoConfig(env: Record<string, string | undefined>): DemoConfig {
  const secretKey = env.MAYARIN_SECRET_KEY;
  const merchantId = env.MAYARIN_MERCHANT_ID;
  const missing = [
    ...(secretKey === undefined || secretKey === "" ? ["MAYARIN_SECRET_KEY"] : []),
    ...(merchantId === undefined || merchantId === "" ? ["MAYARIN_MERCHANT_ID"] : []),
  ];
  if (
    secretKey === undefined ||
    secretKey === "" ||
    merchantId === undefined ||
    merchantId === ""
  ) {
    throw new Error(
      `Missing ${missing.join(" and ")}. Run \`bun run seed\` in apps/demo, ` +
        "or copy the values from `bun run seed:merchant`.",
    );
  }
  return {
    apiUrl: (env.MAYARIN_API_URL ?? "http://localhost:3000").replace(/\/+$/, ""),
    merchant: {
      id: merchantId,
      name: env.MAYARIN_MERCHANT_NAME ?? "Parahyangan Supply",
      city: env.MAYARIN_MERCHANT_CITY ?? "Bandung",
      countryCode: env.MAYARIN_MERCHANT_COUNTRY ?? "ID",
    },
    publicUrl: (env.DEMO_PUBLIC_URL ?? "http://localhost:5173").replace(/\/+$/, ""),
    secretKey,
    ...(env.MAYARIN_WEBHOOK_SECRET === undefined || env.MAYARIN_WEBHOOK_SECRET === ""
      ? {}
      : { webhookSecret: env.MAYARIN_WEBHOOK_SECRET }),
  };
}

export interface CheckoutRequest {
  /** The storefront's own order id. Becomes the intent's `merchantReference`. */
  readonly orderId: string;
  readonly lines: readonly { readonly productId: string; readonly quantity: number }[];
}

export function parseCheckoutRequest(body: unknown): CheckoutRequest | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const { orderId, lines } = body as { orderId?: unknown; lines?: unknown };
  if (typeof orderId !== "string" || orderId === "" || orderId.length > 255) return undefined;
  if (!Array.isArray(lines) || lines.length === 0) return undefined;
  const valid = lines.every(
    (line) =>
      typeof line === "object" &&
      line !== null &&
      typeof (line as { productId?: unknown }).productId === "string" &&
      (line as { productId: string }).productId !== "" &&
      typeof (line as { quantity?: unknown }).quantity === "number" &&
      Number.isInteger((line as { quantity: number }).quantity) &&
      (line as { quantity: number }).quantity > 0,
  );
  return valid ? { orderId, lines: lines as CheckoutRequest["lines"] } : undefined;
}

/**
 * The cart checkout body for one order.
 *
 * `merchantReference` is the order id, so a payment can be read back to the
 * order that caused it — on the success page, in the dashboard, and in the
 * webhook. `checkoutSuccessBaseUrl` is where the hosted checkout sends the
 * buyer once the payment completes. Nothing about the shipping address is
 * sent: it is the storefront's record, not the clearing layer's.
 */
export function cartCheckoutBody(config: DemoConfig, request: CheckoutRequest): CheckoutCartBody {
  return {
    merchant: config.merchant,
    currency: DEMO_CURRENCY,
    lines: [...request.lines],
    merchantReference: request.orderId,
    metadata: { checkoutSuccessBaseUrl: `${config.publicUrl}/checkout/success` },
  };
}

/** The hosted payment page for a minted intent. Served by the API itself. */
export function hostedPaymentUrl(config: DemoConfig, intentId: string): string {
  return `${config.apiUrl}/checkout/pay/${encodeURIComponent(intentId)}`;
}

interface DemoWebhookEvent {
  readonly paymentIntentId: string;
  readonly state: string;
}

export function parseWebhookEvent(payload: unknown): DemoWebhookEvent | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const data = (payload as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return undefined;
  const { paymentIntentId, state } = data as {
    paymentIntentId?: unknown;
    state?: unknown;
  };
  return typeof paymentIntentId === "string" && typeof state === "string"
    ? { paymentIntentId, state }
    : undefined;
}

const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

/**
 * The demo API. Returns `undefined` for a path it does not own, so the caller
 * falls through to the storefront's own assets.
 *
 * `GET /api/products` lists the catalog, `POST /api/checkout` mints one intent
 * for an order, `POST /api/webhooks/mayarin` verifies the signed event, and
 * `GET /api/payment-status/:intentId` is what the success page polls.
 */
export function demoRoutes(
  config: DemoConfig,
): (request: Request) => Promise<Response | undefined> {
  const mayarin = createMayarin({ baseUrl: config.apiUrl, secretKey: config.secretKey });
  // A webhook arrives once; the success page may be reopened long after. The
  // set is this demo's stand-in for the order table a real storefront keeps.
  const successfulPayments = new Set<string>();

  async function route(request: Request, pathname: string): Promise<Response | undefined> {
    if (request.method === "GET" && pathname === "/api/products") {
      const products = await mayarin.commerce.products.list(config.merchant.id);
      return json({ products });
    }

    if (request.method === "POST" && pathname === "/api/checkout") {
      const checkout = parseCheckoutRequest(await request.json());
      if (checkout === undefined) {
        return json(
          {
            error: "Expected { orderId, lines: [{ productId, quantity: positive integer }] }",
          },
          400,
        );
      }
      // Keyed by the order, so a retried Continue resolves to the same intent
      // rather than minting a second one for the same order.
      const intent = await mayarin.commerce.carts.checkout(cartCheckoutBody(config, checkout), {
        idempotencyKey: `demo-order:${checkout.orderId}`,
      });
      return json({ id: intent.id, url: hostedPaymentUrl(config, intent.id) });
    }

    if (request.method === "POST" && pathname === "/api/webhooks/mayarin") {
      if (config.webhookSecret === undefined) {
        return json({ error: "MAYARIN_WEBHOOK_SECRET is not configured" }, 503);
      }
      const signature = request.headers.get(WEBHOOK_SIGNATURE_HEADER);
      if (signature === null) return json({ error: "Invalid webhook signature" }, 401);
      let payload: unknown;
      try {
        // The SDK owns the signature scheme: timestamp tolerance, the `v1`
        // list, and a constant-time compare.
        payload = await constructWebhook({
          payload: await request.text(),
          signature,
          secret: config.webhookSecret,
        });
      } catch (error) {
        if (error instanceof MayarinWebhookError) {
          return json({ error: "Invalid webhook signature" }, 401);
        }
        throw error;
      }
      // A webhook is a signal, not truth: the intent is read back over the
      // merchant surface before this store treats the order as paid.
      const event = parseWebhookEvent(payload);
      if (event?.state === "SUCCESS") {
        const intent = await mayarin.payment.getIntent(event.paymentIntentId);
        if (intent.status === "COMPLETED" && intent.merchant.id === config.merchant.id) {
          successfulPayments.add(event.paymentIntentId);
        }
      }
      return json({ received: true }, 202);
    }

    const intentId = /^\/api\/payment-status\/([^/]+)$/.exec(pathname)?.[1];
    if (request.method === "GET" && intentId !== undefined) {
      const intent = await mayarin.payment.getIntent(intentId);
      const success = intent.merchant.id === config.merchant.id && intent.status === "COMPLETED";
      if (success) successfulPayments.add(intentId);
      // The intent is fetched every poll anyway, so the success page can show
      // what was paid without a second round-trip: the priced amount, the rail
      // the payer used, when it settled, and which order it belongs to.
      return json({
        referencePaymentId: intentId,
        success: success || successfulPayments.has(intentId),
        merchantName: intent.merchant.name,
        amount: intent.amount,
        payment: intent.payment,
        completedAt: intent.completedAt,
        merchantReference: intent.merchantReference,
      });
    }

    return pathname.startsWith("/api/") ? json({ error: "Not found" }, 404) : undefined;
  }

  return async (request) => {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith("/api/")) return undefined;
    try {
      return await route(request, pathname);
    } catch (error: unknown) {
      return errorResponse(error);
    }
  };
}

function errorResponse(error: unknown): Response {
  if (isMayarinApiError(error)) {
    return json({ error: error.message }, error.status === 0 ? 502 : error.status);
  }
  console.error("[storefront] unexpected error:", error);
  return json({ error: "An unexpected server error occurred. Please try again." }, 500);
}
