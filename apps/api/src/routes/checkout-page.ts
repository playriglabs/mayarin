/**
 * Hosted checkout (#10, #151).
 *
 * Two pages a buyer sees and a merchant ships nothing to get: the link page,
 * which mints an intent, and the payment page, which shows what to pay and
 * where. Rendering is the checkout UI SPA (`apps/checkout-ui`); these routes
 * decide which page a URL is and inject that decision into the shell as a
 * `window.__BOOTSTRAP__` payload, so the page paints with no fetch of its own.
 *
 * Status is pushed over Server-Sent Events (#13) and polled as a fallback. The
 * poll is not dead code kept out of caution — it is the path a payer behind a
 * proxy that buffers streaming responses actually takes, and a payer who cannot
 * stream must still be able to pay.
 */

import {
  CART_METADATA_KEY,
  isLinkPayable,
  type LinkPreview,
  type PaymentLink,
  type Product,
  parseCartSnapshot,
} from "@mayarin/catalog";
import type { OfferedRail } from "@mayarin/payment-intent";
import { money, NotFoundError, ValidationError, zero } from "@mayarin/shared";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { toString as qrToString } from "qrcode";
import type { Container } from "../container.ts";
import { type MoneyDto, toMoneyDto } from "../dto/money.ts";
import { toRailDto } from "../dto/rails.ts";
import { renderShell, requestOrigin } from "../services/checkout-shell.ts";

/**
 * The fallback poll interval, carried to the SPA in the pay bootstrap.
 *
 * Only reached when the event stream cannot be opened or drops. Kept slow on
 * purpose: it is a safety net, not the primary path.
 */
export const POLL_MS = 8_000;

/** How often a quiet stream writes, so an idle proxy does not close it. */
const KEEPALIVE_MS = 25_000;

/** Statuses after which nothing further will ever be sent. */
const TERMINAL_STATUSES: readonly string[] = ["COMPLETED", "FAILED", "EXPIRED"];

export function checkoutPageRoutes(container: Container): Hono {
  const app = new Hono();
  const distDir = container.config.checkoutUiDist;

  /**
   * Renders any string as a QR.
   *
   * Its own endpoint because the deposit URI only exists after the payment has
   * locked a price, so it arrives with a poll rather than with the page. Encodes
   * the string it is given and fetches nothing, so the only thing a caller can
   * do with it is render their own text.
   */
  app.get("/qr", async (c) => {
    const value = c.req.query("value") ?? "";
    if (value.length === 0 || value.length > 512) {
      throw new ValidationError("A QR value must be between 1 and 512 characters", {
        length: value.length,
      });
    }
    return c.body(await qrSvg(value), 200, { "Content-Type": "image/svg+xml" });
  });

  /**
   * Live payment status (#13).
   *
   * Public, like the payment page it serves: an intent id is an unguessable
   * ULID, which is the same posture `GET /payments/:id` already takes. Anyone
   * holding the link can watch that one payment, and nothing else.
   *
   * The stream closes itself once the payment reaches a terminal state — there
   * is nothing further to send, and a socket held open past that point is a
   * socket held for no reason.
   */
  app.get("/events/:intentId", async (c) => {
    const stream = container.stream;
    if (stream === undefined) {
      // Not an error: the page falls back to polling, which still works.
      throw new NotFoundError("Live payment status is not enabled on this deployment", {});
    }

    const intentId = c.req.param("intentId");
    // Resolved before the stream opens, so an unknown id is a clean 404 rather
    // than an open connection that never sends anything.
    const { intent } = await container.paymentApp.getPayment(intentId);

    return streamSSE(c, async (sse) => {
      let closed = false;
      const send = async (event: string, data: string) => {
        if (closed) return;
        await sse.writeSSE({ event, data });
      };

      await send("payment", intent.status);

      const unwatch = stream.watch(intent.id, () => {
        // Fire-and-forget: the browser re-reads the payment, so a dropped nudge
        // costs one poll-interval of latency rather than a wrong status.
        void send("payment", "changed");
      });

      if (unwatch === undefined) {
        // At the process ceiling. Close immediately so the page falls back to
        // polling instead of holding a stream that will never fire.
        closed = true;
        await sse.close();
        return;
      }

      sse.onAbort(() => {
        closed = true;
        unwatch();
      });

      // Held open until the client goes away or the payment is terminal. The
      // keep-alive is what stops an idle proxy closing a quiet connection.
      while (!closed) {
        await sse.sleep(KEEPALIVE_MS);
        if (closed) break;
        const current = await container.paymentApp.getPayment(intent.id);
        if (TERMINAL_STATUSES.includes(current.intent.status)) {
          await send("payment", current.intent.status);
          closed = true;
          unwatch();
          await sse.close();
          return;
        }
        await sse.writeSSE({ event: "ping", data: "" });
      }
    });
  });

  /** The payment page: amount, deposit address, QR, and streamed status. */
  app.get("/pay/:intentId", async (c) => {
    const intentId = c.req.param("intentId");
    const { intent } = await container.paymentApp.getPayment(intentId);
    const paymentLink =
      intent.metadata.paymentLinkId === undefined
        ? undefined
        : await container.catalog.getLink(intent.metadata.paymentLinkId).catch(() => undefined);
    const successUrl = checkoutSuccessUrl(intent.metadata.checkoutSuccessBaseUrl, intent.id);
    const origin = requestOrigin((name) => c.req.header(name), container.config.publicBaseUrl);
    return c.html(
      await renderShell(distDir, {
        page: "pay",
        intentId: intent.id,
        amount: toMoneyDto(intent.amount),
        merchant: { name: intent.merchant.name, city: intent.merchant.city },
        title: paymentLink?.title ?? intent.merchantReference ?? intent.merchant.name,
        lines: await intentLines(container, intent.metadata[CART_METADATA_KEY]),
        expiresAt: intent.expiresAt.toISOString(),
        statusUrl: `${origin}/v1/payments/${intent.id}`,
        streaming: container.stream !== undefined,
        successUrl: successUrl ?? null,
        pollMs: POLL_MS,
      }),
    );
  });

  /**
   * The link page: what is being sold, in what asset, and one button.
   *
   * Registered last because it is the catch-all: Hono matches in registration
   * order, so `/qr` and `/pay/:intentId` would otherwise be read as link ids.
   */
  app.get("/:linkId", async (c) => {
    const link = await container.catalog.getLink(c.req.param("linkId"));
    const payable = isLinkPayable(link, new Date());

    // A catalog link's total lives in the products, so the page cannot add it
    // up; an open link has no total until the buyer types one. Both are the
    // same call, and neither mints anything.
    const preview =
      link.kind === "open"
        ? undefined
        : await container.commerce.previewLink(link.id).catch(() => undefined);

    // The rails, not a chain and a union of assets (#244): this merchant on
    // this deployment, filtered per chain, with the reasons already applied.
    const rails = await container.rails.railsFor(link.merchant.id);

    return c.html(
      await renderShell(
        distDir,
        await linkBootstrap({
          link,
          payable,
          preview,
          rails,
          ttlSeconds: container.config.paymentIntentTtlSeconds,
          products: container.catalog,
        }),
      ),
    );
  });

  return app;
}

async function qrSvg(value: string): Promise<string> {
  return qrToString(value, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
}

export function checkoutSuccessUrl(base: string | undefined, intentId: string): string | undefined {
  if (base === undefined) return undefined;
  try {
    const url = new URL(`${base.replace(/\/+$/, "")}/${encodeURIComponent(intentId)}`);
    return url.protocol === "https:" || url.hostname === "localhost" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

interface LinkBootstrapOptions {
  readonly link: PaymentLink;
  readonly payable: boolean;
  /** Priced lines and total, for a link that prices itself. Absent for `open`. */
  readonly preview: LinkPreview | undefined;
  /**
   * Every `(chain, asset)` pair this merchant can be paid on (#244).
   *
   * The payer picks one, and that choice mints the intent — so the deposit
   * address and the price lock belong to the rail they chose rather than to one
   * the deployment picked for them.
   */
  readonly rails: readonly OfferedRail[];
  readonly ttlSeconds: number;
  readonly products: Pick<Container["catalog"], "getProduct">;
}

/**
 * The link page's bootstrap, mirrored by `apps/checkout-ui/src/features/link/types.ts`.
 *
 * Three things the page deliberately does *not* get:
 *
 * - **No QR.** A QR of the page's own URL belongs to the counter — the
 *   dashboard's "Take payment" — not to the buyer who already has the page.
 * - **No intent.** Minting on page load would expire a price lock while the
 *   buyer typed, and burn a deposit address for everyone who opened the link.
 * - **No price it cannot honour.** The SPA prices estimates through
 *   `POST /v1/quotes` — the same rate provider the lock will read.
 */
async function linkBootstrap(options: LinkBootstrapOptions) {
  const { link, payable, preview, rails, ttlSeconds, products } = options;
  const currency = link.currency ?? link.amount?.asset;

  // An open link has no total until the buyer types one; everything else shows
  // the priced preview, the fixed amount, or a zero rather than nothing at all.
  const total: MoneyDto | null =
    link.kind === "open"
      ? null
      : toMoneyDto(preview?.total ?? link.amount ?? zero(currency ?? "IDR"));

  // Catalog lines, so a buyer can check what they are paying for before they
  // pay for it. A total with nothing behind it is a number taken on trust.
  const lines =
    preview === undefined || link.kind !== "catalog"
      ? null
      : await Promise.all(
          preview.lines.map(async (line) => {
            const product =
              line.productId === undefined ? undefined : await products.getProduct(line.productId);
            return {
              name: line.name,
              description: product?.description ?? null,
              imageUrl: product === undefined ? null : productImage(product),
              quantity: line.quantity,
              unitPrice: toMoneyDto(line.unitPrice),
              lineTotal: toMoneyDto({
                amount: line.unitPrice.amount * BigInt(line.quantity),
                asset: line.unitPrice.asset,
              }),
            };
          }),
        );

  return {
    page: "link",
    linkId: link.id,
    kind: link.kind,
    title: link.title ?? link.merchant.name,
    merchant: { name: link.merchant.name, city: link.merchant.city },
    payable,
    currency: currency ?? null,
    total,
    lines,
    rails: rails.map(toRailDto),
    lockMinutes: Math.max(1, Math.round(ttlSeconds / 60)),
  };
}

function productImage(product: Product): string | null {
  const image = product.metadata.image;
  if (image === undefined) return null;
  try {
    const url = new URL(image);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return image.startsWith("/") ? image : null;
  }
}

async function intentLines(
  container: Container,
  rawSnapshot: string | undefined,
): Promise<
  | readonly {
      readonly name: string;
      readonly description: string | null;
      readonly imageUrl: string | null;
      readonly quantity: number;
      readonly unitPrice: MoneyDto;
      readonly lineTotal: MoneyDto;
    }[]
  | null
> {
  if (rawSnapshot === undefined) return null;
  const snapshot = parseCartSnapshot(rawSnapshot);
  if (snapshot === undefined) return null;

  return Promise.all(
    snapshot.lines.map(async (line) => {
      const product =
        line.productId === undefined
          ? undefined
          : await container.catalog.getProduct(line.productId).catch(() => undefined);
      const unitPrice = money(BigInt(line.unitPrice), snapshot.currency);
      return {
        name: line.name,
        description: product?.description ?? null,
        imageUrl: product === undefined ? null : productImage(product),
        quantity: line.quantity,
        unitPrice: toMoneyDto(unitPrice),
        lineTotal: toMoneyDto({
          amount: unitPrice.amount * BigInt(line.quantity),
          asset: unitPrice.asset,
        }),
      };
    }),
  );
}
