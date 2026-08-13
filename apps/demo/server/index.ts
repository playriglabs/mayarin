/**
 * The thin server behind the demo marketplace (#137).
 *
 * A merchant storefront never ships its secret key to the browser, so the two
 * calls that need one — list products, mint a payment link — run here, inside
 * the Vite dev server, as connect middleware mounted at `/api`. The browser
 * bundle sees only the two demo routes; the secret stays in `process.env`.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
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
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

interface CheckoutRequest {
  readonly productId: string;
  readonly quantity: number;
}

function parseCheckoutRequest(body: unknown): CheckoutRequest | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const { productId, quantity } = body as { productId?: unknown; quantity?: unknown };
  if (typeof productId !== "string" || productId === "") return undefined;
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1) {
    return undefined;
  }
  return { productId, quantity };
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

  return (req, res, next) => {
    const path = req.url?.split("?")[0];

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
                  error: "Expected { productId: string, quantity: positive integer }",
                });
                return;
              }
              const link = await mayarin.commerce.paymentLinks.create({
                kind: "catalog",
                merchant: config.merchant,
                currency: DEMO_CURRENCY,
                lines: [{ productId: request.productId, quantity: request.quantity }],
              });
              sendJson(res, 200, { url: link.url });
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
      console.error("[demo] unexpected error:", error);
      sendJson(res, 500, { error: "Something went wrong on the demo server." });
    });
  };
}
