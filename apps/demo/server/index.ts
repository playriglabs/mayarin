/**
 * The thin server behind the demo marketplace (#137).
 *
 * A merchant storefront never ships its secret key to the browser, so the two
 * calls that need one — list products, mint a payment link — run here, inside
 * the Vite dev server, as connect middleware mounted at `/api`. The browser
 * bundle sees only the two demo routes; the secret stays in `process.env`.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { PaymentLinkDto } from "@mayarin/api/dto";
import { verifyWebhook, WEBHOOK_SIGNATURE_HEADER } from "@mayarin/notifications";
import { createMayarin, isMayarinApiError, type MayarinClient } from "@mayarin/sdk";

/** The one currency the demo prices in. The point of #137 is the IDR-native flow. */
export const DEMO_CURRENCY = "IDR";

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
 * demo that silently mints no links is worse than one that says why.
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
    apiUrl: env.MAYARIN_API_URL ?? "http://localhost:3000",
    merchant: {
      id: merchantId,
      name: env.MAYARIN_MERCHANT_NAME ?? "Parahyangan Supply",
      city: env.MAYARIN_MERCHANT_CITY ?? "Bandung",
      countryCode: env.MAYARIN_MERCHANT_COUNTRY ?? "ID",
    },
    secretKey,
    publicUrl: (env.DEMO_PUBLIC_URL ?? "http://localhost:5173").replace(/\/+$/, ""),
    ...(env.MAYARIN_WEBHOOK_SECRET === undefined || env.MAYARIN_WEBHOOK_SECRET === ""
      ? {}
      : { webhookSecret: env.MAYARIN_WEBHOOK_SECRET }),
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

async function readText(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  return JSON.parse(await readText(req));
}

interface DemoWebhookEvent {
  readonly paymentIntentId: string;
  readonly state: string;
}

function parseWebhookEvent(rawBody: string): DemoWebhookEvent | undefined {
  const parsed: unknown = JSON.parse(rawBody);
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const data = (parsed as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return undefined;
  const { paymentIntentId, state } = data as {
    paymentIntentId?: unknown;
    state?: unknown;
  };
  return typeof paymentIntentId === "string" && typeof state === "string"
    ? { paymentIntentId, state }
    : undefined;
}

interface CheckoutRequest {
  readonly lines: readonly { readonly productId: string; readonly quantity: number }[];
}

const canonicalLines = (lines: CheckoutRequest["lines"]) =>
  [...lines].sort((left, right) => left.productId.localeCompare(right.productId));

function sameLines(left: CheckoutRequest["lines"], right: CheckoutRequest["lines"]): boolean {
  const a = canonicalLines(left);
  const b = canonicalLines(right);
  return (
    a.length === b.length &&
    a.every((line, index) => {
      const other = b[index];
      return other?.productId === line.productId && other.quantity === line.quantity;
    })
  );
}

export function findReusableCatalogLink(
  links: readonly PaymentLinkDto[],
  request: CheckoutRequest,
  successBaseUrl?: string,
): PaymentLinkDto | undefined {
  return links.find(
    (link) =>
      link.kind === "catalog" &&
      link.payable &&
      link.currency === DEMO_CURRENCY &&
      (successBaseUrl === undefined || link.metadata.checkoutSuccessBaseUrl === successBaseUrl) &&
      link.lines !== null &&
      sameLines(link.lines, request.lines),
  );
}

function catalogLinkIdempotencyKey(merchantId: string, request: CheckoutRequest): string {
  const cart = canonicalLines(request.lines)
    .map((line) => `${line.productId}:${line.quantity}`)
    .join(",");
  return `demo-catalog-v2:${merchantId}:${cart}:${DEMO_CURRENCY}`;
}

async function reusableOrNewCatalogLink(
  mayarin: MayarinClient,
  config: DemoConfig,
  request: CheckoutRequest,
): Promise<PaymentLinkDto> {
  const existing = findReusableCatalogLink(
    await mayarin.commerce.paymentLinks.list(config.merchant.id),
    request,
    `${config.publicUrl}/checkout/success`,
  );
  if (existing !== undefined) return existing;

  return mayarin.commerce.paymentLinks.create(
    {
      kind: "catalog",
      merchant: config.merchant,
      currency: DEMO_CURRENCY,
      lines: [...request.lines],
      metadata: { checkoutSuccessBaseUrl: `${config.publicUrl}/checkout/success` },
    },
    { idempotencyKey: catalogLinkIdempotencyKey(config.merchant.id, request) },
  );
}

function parseCheckoutRequest(body: unknown): CheckoutRequest | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const { lines } = body as { lines?: unknown };
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
  return valid ? { lines: lines as CheckoutRequest["lines"] } : undefined;
}

type NextHandleFunction = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void,
) => void;

/**
 * The demo API, mounted at `/api` so `req.url` arrives with the prefix
 * stripped: `GET /products` lists the catalog, `POST /checkout` mints a
 * `catalog` payment link and returns its hosted-checkout `url`.
 */
export function demoApi(config: DemoConfig): NextHandleFunction {
  const mayarin: MayarinClient = createMayarin({
    baseUrl: config.apiUrl,
    secretKey: config.secretKey,
  });
  const successfulPayments = new Set<string>();

  return (req, res, next) => {
    const path = req.url?.split("?")[0];

    const successMatch = /^\/payment-status\/([^/]+)$/.exec(path ?? "");
    const referencePaymentId = successMatch?.[1];
    const handler =
      req.method === "GET" && path === "/products"
        ? async () => {
            const products = await mayarin.commerce.products.list(config.merchant.id);
            sendJson(res, 200, { products });
          }
        : req.method === "POST" && path === "/checkout"
          ? async () => {
              const request = parseCheckoutRequest(await readJson(req));
              if (request === undefined) {
                sendJson(res, 400, {
                  error: "Expected { lines: [{ productId, quantity: positive integer }] }",
                });
                return;
              }
              const link = await reusableOrNewCatalogLink(mayarin, config, request);
              sendJson(res, 200, { id: link.id, url: link.url });
            }
          : req.method === "POST" && path === "/webhooks/mayarin"
            ? async () => {
                if (config.webhookSecret === undefined) {
                  sendJson(res, 503, { error: "MAYARIN_WEBHOOK_SECRET is not configured" });
                  return;
                }
                const rawBody = await readText(req);
                const signature = req.headers[WEBHOOK_SIGNATURE_HEADER];
                if (
                  typeof signature !== "string" ||
                  !verifyWebhook({
                    header: signature,
                    body: rawBody,
                    secrets: [config.webhookSecret],
                    now: new Date(),
                  })
                ) {
                  sendJson(res, 401, { error: "Invalid webhook signature" });
                  return;
                }
                const event = parseWebhookEvent(rawBody);
                if (event?.state === "SUCCESS") {
                  const intent = await mayarin.payment.getIntent(event.paymentIntentId);
                  if (intent.status === "COMPLETED" && intent.merchant.id === config.merchant.id) {
                    successfulPayments.add(event.paymentIntentId);
                  }
                }
                sendJson(res, 202, { received: true });
              }
            : req.method === "GET" && referencePaymentId !== undefined
              ? async () => {
                  const intent = await mayarin.payment.getIntent(referencePaymentId);
                  const success =
                    intent.merchant.id === config.merchant.id && intent.status === "COMPLETED";
                  if (success) successfulPayments.add(referencePaymentId);
                  sendJson(res, 200, {
                    referencePaymentId,
                    success: success || successfulPayments.has(referencePaymentId),
                  });
                }
              : undefined;

    if (handler === undefined) {
      next();
      return;
    }

    handler().catch((error: unknown) => {
      if (isMayarinApiError(error)) {
        sendJson(res, error.status === 0 ? 502 : error.status, { error: error.message });
        return;
      }
      console.error("[storefront] unexpected error:", error);
      sendJson(res, 500, { error: "Terjadi kesalahan pada server. Coba lagi." });
    });
  };
}
