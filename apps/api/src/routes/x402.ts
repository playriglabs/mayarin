/**
 * The x402 HTTP surface (#207).
 *
 * Three things: a middleware that gates a handler behind payment, a discovery
 * list so an agent can find what is payable, and the facilitator endpoints the
 * specification defines.
 *
 * These routes are **unversioned on purpose**, like the checkout pages. An
 * agent finds a resource by its URL, and the specification's own field for that
 * is `resource.url` — a `/v2` that moved these paths would invalidate every
 * `PaymentRequired` already handed out, including ones sitting in an agent's
 * memory of what a service costs.
 *
 * Nothing here holds payment logic. The middleware reads a header, asks
 * `X402Service`, and writes a header back.
 */

import type { RateQuote } from "@mayarin/clearing";
import { fromDecimalString, isAssetCode, NotFoundError, ValidationError } from "@mayarin/shared";
import {
  decodePaymentPayload,
  encodePaymentRequired,
  encodeSettleResponse,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_REQUIRED_STATUS,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
} from "@mayarin/x402";
import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import type { Container } from "../container.ts";
import type { X402Service } from "../services/x402.ts";

/**
 * The x402 service, or a 404 saying this deployment does not run one.
 *
 * The same shape the contract path uses: an optional subsystem is absent rather
 * than broken, and a route that needs it says so once instead of every caller
 * checking.
 */
function requireX402(container: Container): X402Service {
  const service = container.x402;
  if (service === undefined) {
    throw new NotFoundError("x402 is not enabled on this deployment", {});
  }
  return service;
}

/**
 * Gate a handler behind payment for `resourceId`.
 *
 * No `PAYMENT-SIGNATURE` header means a `402` carrying the price. A header
 * means verify, settle, then run the handler — in that order, because a handler
 * that ran first would have to be undone if the settlement failed, and a
 * resource server cannot un-serve a response.
 *
 * The settlement result rides back on `PAYMENT-RESPONSE` alongside whatever the
 * handler produced, which is what lets a client tie the resource it received to
 * the transaction that paid for it.
 */
export function requirePayment(container: Container, resourceId: string): MiddlewareHandler {
  return async (c, next) => {
    const service = requireX402(container);
    const resource = await service.resourceById(resourceId);
    const header = c.req.header(PAYMENT_SIGNATURE_HEADER);

    if (header === undefined) {
      return respondPaymentRequired(
        c,
        encodePaymentRequired(await service.paymentRequired(resource)),
      );
    }

    const payment = decodePaymentPayload(header);
    const settlement = await service.settle(resource, payment);

    await next();
    c.res.headers.set(PAYMENT_RESPONSE_HEADER, encodeSettleResponse(settlement.response));
    return undefined;
  };
}

function respondPaymentRequired(c: Context, header: string): Response {
  // The body is empty and the header carries everything, which is what the HTTP
  // transport specifies. A client that cannot read the header has not
  // implemented x402 and would not understand a JSON body either.
  return c.body(null, PAYMENT_REQUIRED_STATUS, { [PAYMENT_REQUIRED_HEADER]: header });
}

const facilitatorBodySchema = z
  .object({
    x402Version: z.literal(2),
    paymentPayload: z.record(z.string(), z.unknown()),
    paymentRequirements: z.record(z.string(), z.unknown()),
  })
  .strict();

/**
 * The resource id the gated FX quote is registered under.
 *
 * Fixed rather than configured: `requirePayment` gates a route in code, and a
 * gate whose id came from the environment would 404 for a deployment that spelt
 * it differently — with nothing on the payer's side to say why.
 */
export const FX_QUOTE_RESOURCE_ID = "fx-quote";

type X402Env = { Variables: { fxQuote: RateQuote } };

export function x402Routes(container: Container): Hono<X402Env> {
  const app = new Hono<X402Env>();

  /**
   * A resource an agent can actually buy (#209).
   *
   * The smallest honest one: a price, read through the same rate provider a
   * payment uses, sold per call. It exists because everything else in this rail
   * was demonstrable except the thing being sold — the middleware, the
   * facilitator and the settlement confirmation had no endpoint in front of
   * them.
   *
   * `requirePayment` answers `404` until the resource is registered, which is
   * the same shape as the rest of this file: absent rather than half-working.
   */
  app.get(
    "/fx/quote",
    async (c, next) => {
      const from = c.req.query("from");
      const to = c.req.query("to");
      if (!isAssetCode(from) || !isAssetCode(to)) {
        throw new ValidationError("from and to must both be known asset codes", { from, to });
      }
      if (c.req.header(PAYMENT_SIGNATURE_HEADER) !== undefined) {
        // Prepare the resource before charging. A rejected or unavailable
        // quote must not consume the payer's authorization.
        c.set("fxQuote", await container.rates.quote(from, to, fromDecimalString("1", from)));
      }
      await next();
    },
    requirePayment(container, FX_QUOTE_RESOURCE_ID),
    (c) => {
      const quote = c.get("fxQuote");
      return c.json({
        from: quote.from,
        to: quote.to,
        // Minor units of `to` per one whole unit of `from`, the same integer the
        // clearing engine locks. No float ever holds a rate.
        scaledRate: quote.scaledRate.toString(),
        source: quote.source,
        ...(quote.expiresAt === undefined ? {} : { expiresAt: quote.expiresAt.toISOString() }),
      });
    },
  );

  /**
   * What this deployment will sell, and on what rails.
   *
   * Public and unauthenticated: an agent that has never met Mayarin is the
   * whole point, and a price is not a secret. It lists resources for one
   * merchant, named in the query, so a deployment serving many merchants does
   * not hand every agent the whole catalogue.
   */
  app.get("/resources", async (c) => {
    const service = requireX402(container);
    const merchantId = c.req.query("merchant");
    if (merchantId === undefined) {
      return c.json({ error: "merchant query parameter is required" }, 400);
    }

    const resources = await service.listByMerchant(merchantId);
    return c.json({
      resources: resources.map((resource) => ({
        id: resource.id,
        url: resource.url,
        ...(resource.description === undefined ? {} : { description: resource.description }),
        ...(resource.mimeType === undefined ? {} : { mimeType: resource.mimeType }),
      })),
    });
  });

  /**
   * The `PaymentRequired` for one resource, without asking for it.
   *
   * Not part of the specification — an agent normally learns the price from a
   * `402`. It is here because a client deciding *whether* to call something
   * should not have to make the call it is deciding about, and because the
   * playground needs a price to show.
   */
  app.get("/resources/:id/payment-required", async (c) => {
    const service = requireX402(container);
    const resource = await service.resourceById(c.req.param("id"));
    const required = await service.paymentRequired(resource);
    return c.json(required);
  });

  /**
   * `GET /x402/resources/:id/rail` — which rail, and why.
   *
   * The ordering inside a `402` already carries the answer, but an agent
   * reading `accepts[0]` cannot see what the order was based on. This is the
   * reasoning in the open: median headroom, how many settlements it is over,
   * and whether the choice was a choice at all.
   */
  app.get("/resources/:id/rail", async (c) => {
    const service = requireX402(container);
    const resource = await service.resourceById(c.req.param("id"));
    return c.json(await service.railChoice(resource));
  });

  /**
   * `POST /x402/verify` — would this authorization go through?
   *
   * Mayarin acting as a facilitator for its own resources. The body carries a
   * `paymentRequirements` per the specification, and it is **not** what gets
   * verified: the requirements are rebuilt from the resource, and the payer's
   * copy is used only to identify which option they chose. A facilitator that
   * verified against the requirements handed to it would verify a payment
   * against its own claims.
   */
  app.post("/resources/:id/verify", async (c) => {
    const service = requireX402(container);
    const body = facilitatorBodySchema.parse(await c.req.json());
    const resource = await service.resourceById(c.req.param("id"));
    const payment = decodePaymentPayload(encodeJson(body.paymentPayload));
    return c.json(await service.verify(resource, payment));
  });

  /** `POST /x402/settle` — broadcast it, and credit the merchant. */
  app.post("/resources/:id/settle", async (c) => {
    const service = requireX402(container);
    const body = facilitatorBodySchema.parse(await c.req.json());
    const resource = await service.resourceById(c.req.param("id"));
    const payment = decodePaymentPayload(encodeJson(body.paymentPayload));
    const settlement = await service.settle(resource, payment);
    return c.json(settlement.response);
  });

  return app;
}

/**
 * Re-encode a JSON body so it goes through the same decoder as a header.
 *
 * The facilitator endpoints carry the payload as JSON and the transport carries
 * it base64-encoded, and the validation that matters — version, `accepted`,
 * `payload` — lives in the decoder. Routing both through it means a payload
 * cannot be structurally wrong on one path and accepted on the other.
 */
function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}
