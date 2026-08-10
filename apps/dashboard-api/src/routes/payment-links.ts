/**
 * Payment link routes (#15).
 *
 * A link is a template: the buyer opening it mints a fresh Payment Intent with
 * its own price lock and expiry, which is what lets one printed QR on a counter
 * serve every sale of the day. Minting happens on the payment API — the
 * dashboard creates the template and hands back the URL.
 *
 * Behind `require-auth` + `requirePermission("catalog:manage")`. Creating a link
 * decides what a buyer is charged; it never decides where the money lands, which
 * is why this is not `settings:manage`.
 */

import {
  type AssetCode,
  assetCodeSchema,
  fromDecimalString,
  toDecimalString,
  UnauthorizedError,
  ValidationError,
} from "@mayarin/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { Container } from "../container.ts";
import type { Scope } from "../dto/auth.ts";
import { createLinkBodySchema, toCreateLinkInput, toPaymentLinkDto } from "../dto/catalog.ts";
import { csrfMiddleware } from "../middleware/csrf.ts";
import type { AuthVars } from "../middleware/types.ts";

/**
 * What a counter sale needs beyond the link itself.
 *
 * `asset` is what the payer sends, not what the merchant settles in — one of
 * the merchant's accepted assets, chosen at the counter because it is the payer
 * who decides what is in their wallet. `amount` is required by an `open` link
 * and refused by the others, which the payment API enforces.
 */
const chargeBodySchema = z
  .object({
    asset: assetCodeSchema,
    amount: z.object({ amount: z.string(), asset: assetCodeSchema }).optional(),
  })
  .strict();

/** An `open` link is priced at the counter; the others carry their own amount. */
const quoteBodySchema = z
  .object({ amount: z.object({ amount: z.string(), asset: assetCodeSchema }).optional() })
  .strict();

/**
 * What this link charges, in the merchant's own currency.
 *
 * Three shapes, one answer: a `fixed` link carries its amount, an `open` link
 * takes the counter's, and a **`catalog` link carries neither** — its price is
 * in the products it names, which is why this resolves the link rather than
 * reading a field. Refusing on a missing field turned every catalog link into
 * "This link has no amount".
 */
async function chargeableAmount(
  container: Container,
  scope: Scope,
  linkId: string,
  typed: { readonly amount: string; readonly asset: string } | undefined,
): Promise<{ amount: string; asset: AssetCode }> {
  const amount =
    typed === undefined
      ? undefined
      : { amount: typed.amount, asset: assetCodeSchema.parse(typed.asset) };

  const preview = await container.catalog.previewLink(
    scope,
    linkId,
    amount === undefined ? undefined : fromDecimalString(amount.amount, amount.asset),
  );

  return { amount: toDecimalString(preview.total), asset: preview.total.asset };
}

export function paymentLinkRoutes(container: Container): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();

  const checkoutBaseUrl = container.config.checkoutBaseUrl;

  const scopeOf = (c: { get: (key: "scope") => AuthVars["scope"] }) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");
    return scope;
  };

  app.get("/", async (c) => {
    const links = await container.catalog.listLinks(scopeOf(c));
    const now = new Date();
    return c.json({
      paymentLinks: links.map((link) => toPaymentLinkDto(link, checkoutBaseUrl, now)),
    });
  });

  app.post("/", csrfMiddleware(), async (c) => {
    const body = createLinkBodySchema.parse(await c.req.json());
    const link = await container.catalog.createLink(scopeOf(c), toCreateLinkInput(body));
    return c.json({ paymentLink: toPaymentLinkDto(link, checkoutBaseUrl, new Date()) }, 201);
  });

  app.get("/:id", async (c) => {
    const link = await container.catalog.getLink(scopeOf(c), c.req.param("id"));
    return c.json({ paymentLink: toPaymentLinkDto(link, checkoutBaseUrl, new Date()) });
  });

  /**
   * What each accepted asset would take, for this link (#15).
   *
   * Asked before a sale is started, so the counter can show the customer their
   * options — "that's 0.0021 ETH or 5.02 USDC" — and let them pick. Indicative:
   * the number a payer is actually charged is locked when the payment is
   * confirmed, which is a moment later and against the same rate provider.
   *
   * A GET would be the obvious shape, but an `open` link has no amount until
   * the counter names one, and an amount belongs in a body rather than in a URL
   * that gets logged.
   */
  app.post("/:id/quote", csrfMiddleware(), async (c) => {
    const scope = scopeOf(c);
    const body = quoteBodySchema.parse(await c.req.json().catch(() => ({})));

    // The merchant's own accepted set decides which assets are offered.
    const merchant = await container.settings.get(scope);
    const amount = await chargeableAmount(container, scope, c.req.param("id"), body.amount);

    return c.json(await container.paymentApi.quote(amount, merchant.acceptedAssets));
  });

  /**
   * Takes a payment at the counter (#15).
   *
   * Mints one payment from this link and prices it, so the merchant can show a
   * QR the payer scans with their own wallet. This is not the same thing as the
   * link's `url`: that is a web page, and a phone wallet scanning it opens a
   * browser rather than a transfer. A deposit address exists per payment and is
   * allocated at price lock, which is why it cannot live on the link itself —
   * one printed link serves every sale, and every sale needs its own address.
   */
  app.post("/:id/charge", csrfMiddleware(), async (c) => {
    const scope = scopeOf(c);
    // Ownership first: the payment API takes a link id and does not know whose
    // session is asking, so the check has to happen on this side of the call.
    const link = await container.catalog.getLink(scope, c.req.param("id"));
    const body = chargeBodySchema.parse(await c.req.json().catch(() => ({})));

    // Priced before anything is minted.
    //
    // The counter used to mint an intent and discover at the price lock that
    // the pair cannot be priced at all — leaving a FAILED payment behind for
    // every press of the button, none of which was ever a payment. The quote
    // reads the same source the lock reads, so a pair that cannot price is
    // refused here, before a record exists.
    const charged = await chargeableAmount(container, scope, link.id, body.amount);
    const priceable = await container.paymentApi.quote(charged, [body.asset]);
    const line = priceable.quotes.find((quote) => quote.asset === body.asset);
    if (line !== undefined && !line.available) {
      throw new ValidationError(line.reason ?? `${body.asset} cannot be priced for this payment`, {
        asset: body.asset,
        linkId: link.id,
      });
    }

    const { paymentIntentId } = await container.paymentApi.charge({
      linkId: link.id,
      payment: { asset: body.asset, chain: container.config.depositChain },
      ...(body.amount === undefined ? {} : { amount: body.amount }),
    });

    return c.json({ paymentIntentId }, 201);
  });

  /** Retires a link. Intents already minted from it are untouched — they are payments. */
  app.post("/:id/disable", csrfMiddleware(), async (c) => {
    const link = await container.catalog.disableLink(scopeOf(c), c.req.param("id"));
    return c.json({ paymentLink: toPaymentLinkDto(link, checkoutBaseUrl, new Date()) });
  });

  return app;
}
