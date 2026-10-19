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

import { Buffer } from "node:buffer";
import {
  CART_METADATA_KEY,
  isLinkPayable,
  type LinkPreview,
  type PaymentLink,
  type Product,
  parseCartSnapshot,
} from "@mayarin/catalog";
import { chainLabel } from "@mayarin/chain";
import { ESCROW_CHAINS } from "@mayarin/provider-evm";
import { money, NotFoundError, ValidationError, zero } from "@mayarin/shared";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { toString as qrToString } from "qrcode";
import sharp from "sharp";
import type { Container } from "../container.ts";
import { type MoneyDto, toMoneyDto } from "../dto/money.ts";
import type { RailDto } from "../dto/rails.ts";
import { merchantLogoUrl } from "../merchant-logo.ts";
import { payerAccess } from "../middleware/payer-access.ts";
import { linkRails, payerRails } from "../rails.ts";
import { requestOrigin, shellResponse } from "../services/checkout-shell.ts";
import { fetchLogo } from "../services/document-pdf.ts";
import { type ProtectionOffer, protectionOffer } from "../services/protection.ts";

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

/** Canonical source for the mark embedded in branded payment-link QR codes. */
const MAYARIN_MARK_SOURCE = "https://mayarin.xyz/brand-kit/mayarin-white.png";

/**
 * The API image contains the landing app too, so both surfaces read the same
 * official asset. Embedding its bytes keeps a downloaded QR self-contained.
 */
const MAYARIN_MARK_FILE = new URL(
  "../../../landing/public/brand-kit/mayarin-white.png",
  import.meta.url,
);

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

    const branded = c.req.query("brand") === "mayarin";
    const png = c.req.query("format") === "png";
    c.header("Content-Type", png ? "image/png" : "image/svg+xml");
    if (c.req.query("download") === "true") {
      c.header(
        "Content-Disposition",
        `attachment; filename="mayarin-payment-qr.${png ? "png" : "svg"}"`,
      );
    }
    // A branded link QR carries the merchant's own logo when they uploaded one.
    const linkId = c.req.query("link");
    const mark = !branded
      ? undefined
      : ((linkId === undefined ? undefined : await merchantLogoMark(container, linkId)) ??
        (await mayarinMark()));
    const svg = await qrSvg(value, mark);
    if (png) return c.body(await qrPng(svg));
    return c.body(svg);
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
  app.get("/events/:intentId", payerAccess(container, "intentId"), async (c) => {
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
  app.get("/pay/:intentId", payerAccess(container, "intentId"), async (c) => {
    const intentId = c.req.param("intentId");
    const { intent } = await container.paymentApp.getPayment(intentId);
    const paymentLink =
      intent.metadata.paymentLinkId === undefined
        ? undefined
        : await container.catalog.getLink(intent.metadata.paymentLinkId).catch(() => undefined);
    const successUrl = checkoutSuccessUrl(intent.metadata.checkoutSuccessBaseUrl, intent.id);
    const origin = requestOrigin((name) => c.req.header(name), container.config.publicBaseUrl);

    // Minted without a rail — a storefront's cart checkout rings up the sale
    // before the buyer has said how they will pay — so the page asks first, with
    // the rails a link page would offer. Without this it waited on a deposit
    // address that could never be allocated, because nothing had chosen a rail.
    const report =
      intent.status === "CREATED" && intent.payment === undefined
        ? await container.rails.describe(intent.merchant.id)
        : undefined;
    const choice =
      report === undefined
        ? null
        : {
            rails: (
              await payerRails(
                paymentLink === undefined ? report.rails : linkRails(report, paymentLink),
              )
            ).filter(
              // An escrowed payment settles through EscrowFactory, which is
              // deployed on some chains only (#304).
              (rail) => intent.escrow === undefined || ESCROW_CHAINS.includes(rail.chain),
            ),
            lockMinutes: Math.max(1, Math.round(container.config.paymentIntentTtlSeconds / 60)),
          };

    return shellResponse(c, distDir, {
      page: "pay",
      intentId: intent.id,
      // The request's own token when it brought one, so the address bar and the
      // API calls agree; a merchant or the dashboard API opening the page gets a fresh one.
      payerToken: c.req.query("t") ?? container.payerTokens.mint(intent.id),
      amount: toMoneyDto(intent.amount),
      merchant: {
        name: intent.merchant.name,
        city: intent.merchant.city,
        logoUrl: await merchantLogoUrl(container, intent.merchant.id),
      },
      title: paymentLink?.title ?? intent.merchantReference ?? intent.merchant.name,
      // A counter QR's only line is its own title at the amount typed, which
      // the heading above already says.
      lines:
        paymentLink?.kind === "open"
          ? null
          : await intentLines(container, intent.metadata[CART_METADATA_KEY]),
      expiresAt: intent.expiresAt.toISOString(),
      statusUrl: `${origin}/v1/payments/${intent.id}`,
      streaming: container.stream !== undefined,
      successUrl: successUrl ?? null,
      pollMs: POLL_MS,
      choice,
      // Offered only while the rail is being chosen; the paid page reads the
      // escrow itself.
      protection:
        choice === null
          ? null
          : await protectionOffer(container, intent.merchant.id, intent.escrow),
      escrowed: intent.escrow !== undefined,
    });
  });

  /**
   * The link page: what is being sold, in what asset, and one button.
   *
   * Registered last because it is the catch-all: Hono matches in registration
   * order, so `/qr` and `/pay/:intentId` would otherwise be read as link ids.
   */
  app.get("/:linkId", async (c) => {
    const link = await container.catalog.getLink(c.req.param("linkId"));
    const offeredByLink = isLinkPayable(link, new Date());

    // A catalog link's total lives in the products, so the page cannot add it
    // up; an open link has no total until the buyer types one. Both are the
    // same call, and neither mints anything.
    const preview =
      link.kind === "open"
        ? undefined
        : await container.commerce.previewLink(link.id).catch(() => undefined);
    const priceable = link.kind === "open" || preview !== undefined;
    const payable = offeredByLink && priceable;

    // The rails, not a chain and a union of assets (#244): this merchant on
    // this deployment, filtered per chain, with the reasons already applied.
    // `describe` rather than `railsFor` because the page also needs what the
    // merchant settles in: it decides whether an estimate has a swap leg.
    // Then narrowed to what this link exposes (#259) — the intersection never
    // widens the catalog — and ranked by what the rails have been doing
    // (#260), on this same read: the observation source is an injected port,
    // so the page gains no second round trip.
    const report = await container.rails.describe(link.merchant.id);
    const offered = linkRails(report, link);

    return shellResponse(
      c,
      distDir,
      await linkBootstrap({
        link,
        payable,
        preview,
        rails: await payerRails(offered),
        unpayableReason:
          offeredByLink && !priceable
            ? "This catalog price is no longer available. Contact the merchant for an updated payment link."
            : payable && offered.length === 0 && link.rails !== undefined
              ? `This link only accepts ${link.rails.map((rail) => `${rail.asset} on ${chainLabel(rail.chain)}`).join(", ")}, which the merchant cannot be paid on right now.`
              : null,
        ttlSeconds: container.config.paymentIntentTtlSeconds,
        products: container.catalog,
        protection: await protectionOffer(container, link.merchant.id, undefined),
        logoUrl: await merchantLogoUrl(container, link.merchant.id),
      }),
    );
  });

  return app;
}

/** The centre badge: the image as a data URI, and where it came from. */
interface QrMark {
  readonly dataUri: string;
  readonly source: string;
}

/** Without a `mark` the QR is plain. */
async function qrSvg(value: string, mark?: QrMark): Promise<string> {
  const svg = await qrToString(value, {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: mark === undefined ? "M" : "H",
  });
  return mark === undefined ? svg : withMark(svg, mark);
}

/**
 * The link's merchant logo as a data URI, or `undefined` when there is none.
 *
 * Inlined rather than linked: neither an `<img>`-loaded SVG nor sharp fetches a
 * remote `href`. A logo that cannot be fetched leaves the Mayarin mark in place
 * rather than failing the QR — the code is what scans, the logo is decoration.
 */
async function merchantLogoMark(container: Container, linkId: string): Promise<QrMark | undefined> {
  const link = await container.catalog.getLink(linkId);
  const logoUrl = await merchantLogoUrl(container, link.merchant.id);
  if (logoUrl === null) return undefined;
  const bytes = await fetchLogo(logoUrl);
  if (bytes === undefined) return undefined;
  const mime =
    bytes[0] === 0x89 && bytes[1] === 0x50
      ? "image/png"
      : bytes[0] === 0xff && bytes[1] === 0xd8
        ? "image/jpeg"
        : undefined;
  if (mime === undefined) return undefined;
  return {
    dataUri: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`,
    source: `Merchant logo source: ${logoUrl}`,
  };
}

/** Adds the centre badge without changing the QR's encoded value. */
function withMark(svg: string, { dataUri, source }: QrMark): string {
  const side = qrViewBoxSide(svg);
  const roundedMarkSide = Math.round(side * 0.25);
  // Matching parity keeps an integer-sized badge exactly centred on the QR's
  // integer module grid. Fractional edges render as a faint grey border.
  const markSide = roundedMarkSide % 2 === side % 2 ? roundedMarkSide : roundedMarkSide + 1;
  const markOffset = (side - markSide) / 2;
  const mark = [
    `<metadata>${source}</metadata>`,
    `<defs><clipPath id="mayarin-mark-clip"><rect x="${markOffset}" y="${markOffset}" width="${markSide}" height="${markSide}" rx="0.4"/></clipPath></defs>`,
    `<image x="${markOffset}" y="${markOffset}" width="${markSide}" height="${markSide}" href="${dataUri}" preserveAspectRatio="xMidYMid meet" clip-path="url(#mayarin-mark-clip)"/>`,
    `<rect x="${markOffset}" y="${markOffset}" width="${markSide}" height="${markSide}" rx="0.4" fill="none" stroke="#d4d4d4" stroke-width="0.15"/>`,
  ].join("");
  return svg.replace("</svg>", `${mark}</svg>`);
}

function qrViewBoxSide(svg: string): number {
  const side = svg.match(/viewBox="0 0 (\d+) \d+"/)?.[1];
  if (side === undefined) throw new Error("QR SVG is missing its square viewBox");
  return Number(side);
}

async function mayarinMark(): Promise<QrMark> {
  const bytes = await Bun.file(MAYARIN_MARK_FILE).arrayBuffer();
  return {
    dataUri: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
    source: `Mayarin brand mark source: ${MAYARIN_MARK_SOURCE}`,
  };
}

async function qrPng(svg: string): Promise<Uint8Array<ArrayBuffer>> {
  const png = await sharp(Buffer.from(svg))
    .resize(1200, 1200, { fit: "fill", kernel: "nearest" })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return Uint8Array.from(png);
}

export function checkoutSuccessUrl(base: string | undefined, intentId: string): string | undefined {
  if (base === undefined) return undefined;
  try {
    const url = new URL(`${base.replace(/\/+$/, "")}/${encodeURIComponent(intentId)}`);
    // The scheme is checked, not just the host: `javascript://localhost/%0Aalert(1)`
    // parses with the hostname `localhost` and would run in the checkout origin.
    const secure = url.protocol === "https:";
    const local = url.protocol === "http:" && url.hostname === "localhost";
    return secure || local ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

interface LinkBootstrapOptions {
  readonly link: PaymentLink;
  /** Buyer protection the merchant offers (#304). */
  readonly protection: ProtectionOffer | null;
  readonly payable: boolean;
  /** Priced lines and total, for a link that prices itself. Absent for `open`. */
  readonly preview: LinkPreview | undefined;
  /**
   * Every `(chain, asset)` pair this link may be paid on (#244, #259), ranked
   * by how each rail has been behaving (#260).
   *
   * The payer picks one, and that choice mints the intent — so the deposit
   * address and the price lock belong to the rail they chose rather than to one
   * the deployment picked for them. The ranking orders the menu; it never
   * removes a rail the merchant accepts.
   */
  readonly rails: readonly RailDto[];
  /**
   * Why the rails list is empty, when the link itself narrowed it to nothing
   * (#259). The page states the reason rather than showing a chooser with
   * nothing in it; `null` when the list is empty because the merchant has no
   * rail at all, which the page already knows how to say.
   */
  readonly unpayableReason: string | null;
  readonly ttlSeconds: number;
  readonly products: Pick<Container["catalog"], "getProduct">;
  readonly logoUrl: string | null;
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
  const {
    link,
    payable,
    preview,
    rails,
    unpayableReason,
    ttlSeconds,
    products,
    protection,
    logoUrl,
  } = options;
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
    merchant: { name: link.merchant.name, city: link.merchant.city, logoUrl },
    payable,
    currency: currency ?? null,
    total,
    lines,
    rails,
    unpayableReason,
    lockMinutes: Math.max(1, Math.round(ttlSeconds / 60)),
    protection,
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
