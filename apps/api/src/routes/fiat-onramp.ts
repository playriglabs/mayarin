/**
 * Local-currency funding of a payment (TransFi).
 *
 * The payer pays in GCash, QRIS, FPX or similar; TransFi delivers the stablecoin
 * to the intent's own deposit address, and the chain watcher takes it from there.
 * Nothing here settles anything — it only opens an order that ends at an address
 * the payment already has.
 *
 * Open, like the other checkout endpoints: the payer on the hosted page has no
 * key, and the payment id is unguessable.
 *
 * TransFi requires the payer's identity before it takes an order. That is passed
 * through and not kept: it is never written to our database or logs.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  BelowMinimumError,
  chooseLocalCurrencyRail,
  detailsFor,
  fiatAmountFor,
  needsVerification,
  transfiSupportedPairs,
  transfiTokenCode,
} from "@mayarin/provider-transfi";
import {
  ConflictError,
  getAsset,
  isAssetCode,
  NotFoundError,
  toDecimalString,
  ValidationError,
} from "@mayarin/shared";
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { z } from "zod";
import type { Container } from "../container.ts";
import {
  payerAccess,
  RETURN_COOKIE,
  RETURN_COOKIE_MAX_AGE_SECONDS,
  returnPath,
  returnUrlFor,
} from "../middleware/payer-access.ts";

/** Every currency TransFi lists as a deposit currency for these markets carries two decimals. */
const FIAT_DECIMALS = 2;

/**
 * How far above the required amount a payment may deliver before it is refused.
 *
 * A method's minimum can exceed a small payment, and the difference would sit in
 * the deposit address as an overpayment the payer cannot reclaim. Past this the
 * payer is told to use another method instead of being charged the minimum.
 */
const MAX_OVERPAYMENT = 1.5;

const methodFields = {
  currency: z.string().regex(/^[A-Z]{3}$/),
  paymentCode: z.string().min(1).max(64),
  paymentType: z.string().min(1).max(32),
};

const payerSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  country: z.string().regex(/^[A-Z]{2}$/),
  dateOfBirth: z.string().regex(/^\d{2}-\d{2}-\d{4}$/),
  email: z.string().email().max(254),
  phone: z.string().regex(/^\d{6,15}$/),
  phoneCode: z.string().regex(/^\+\d{1,4}$/),
  // TransFi takes any non-empty address; the city is all the form asks for.
  address: z.object({
    city: z.string().trim().min(1).max(100),
    street: z.string().trim().min(1).max(200).optional(),
    state: z.string().trim().min(1).max(100).optional(),
    postalCode: z.string().trim().min(1).max(20).optional(),
  }),
});

/** What a method asks for alongside the order — a subset of the identity. */
const contactSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().email().max(254),
  phone: z.string().regex(/^\d{6,15}$/),
  phoneCode: z.string().regex(/^\+\d{1,4}$/),
});

/**
 * First call carries the payer's identity. If TransFi wants the payer's email
 * confirmed first, the answer is `verification-required` with a token, and the
 * second call carries that token plus the contact the method asks for — the full
 * identity (date of birth, address) is not sent twice.
 */
const orderBodySchema = z.union([
  z.object({ ...methodFields, payer: payerSchema }),
  z.object({
    ...methodFields,
    userId: z.string().regex(/^UX-\d+$/),
    token: z.string().length(64),
    contact: contactSchema,
  }),
]);

const railBodySchema = z
  .object({
    linkId: z.string().min(1).max(100).optional(),
    paymentId: z.string().min(1).max(100).optional(),
    rails: z
      .array(
        z.object({
          chain: z.string().min(1).max(64),
          asset: z.string().min(1).max(16),
          settlementAsset: z.string().min(1).max(16),
        }),
      )
      .max(64),
  })
  .refine((body) => (body.linkId === undefined) !== (body.paymentId === undefined), {
    message: "Exactly one of linkId or paymentId is required",
  });

export function fiatOnrampRoutes(container: Container): Hono {
  const app = new Hono();

  /**
   * Binds a TransFi user to the payment that created it. Without this, a
   * `userId` in a request body would let anyone open an order under somebody
   * else's verified identity. Keyed by the deployment's own TransFi secret, so
   * nothing new is stored.
   */
  function sign(paymentId: string, userId: string): string {
    return createHmac("sha256", container.config.transfiPassword ?? "")
      .update(`${paymentId}:${userId}`)
      .digest("hex");
  }

  function client() {
    const transfi = container.transfi;
    if (transfi === undefined) throw new NotFoundError("Local-currency payment is not enabled");
    return transfi;
  }

  /** TransFi's sandbox moves no value, so only there may a testnet stand in for a mainnet. */
  const sandbox = () => (container.config.transfiBaseUrl ?? "").includes("sandbox");

  /**
   * Which of a payment's rails a local-currency payment is delivered on.
   *
   * The rule is the deployment's and the merchant's, not the page's: the page
   * only offers the candidates it already shows the payer. The answer is still
   * checked where it is used — confirming the intent on a rail the payment does
   * not offer is refused there — so a caller inventing a rail gains nothing.
   */
  app.post("/rail", async (c) => {
    client();
    const parsed = railBodySchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) {
      throw new ValidationError("Invalid request", { issues: parsed.error.issues });
    }
    const body = parsed.data;

    const merchantId =
      body.linkId !== undefined
        ? (await container.catalog.getLink(body.linkId)).merchant.id
        : (await container.intents.getById(body.paymentId as string)).merchant.id;
    const merchant = await container.merchants.findById(merchantId);

    const rail = chooseLocalCurrencyRail(body.rails, {
      sandbox: sandbox(),
      preferredChain: merchant?.localCurrencyChain,
    });
    return c.json({ rail: rail ?? null });
  });

  /**
   * The chain and asset pairs the provider can deliver to in this mode, so the
   * merchant's settings can say which of their networks a local-currency payment
   * may land on rather than letting them choose one that cannot work.
   */
  app.get("/networks", (c) => {
    client();
    return c.json({ networks: transfiSupportedPairs({ sandbox: sandbox() }) });
  });

  /**
   * The currencies the provider takes a deposit in, so a page offers only the
   * markets that can work. Held for a minute: it changes when the provider's
   * account does, and every checkout asks.
   */
  let currencies: { readonly at: number; readonly list: readonly string[] } | undefined;
  app.get("/currencies", async (c) => {
    const transfi = client();
    const now = Date.now();
    if (currencies === undefined || now - currencies.at > 60_000) {
      // What the provider takes, narrowed to what this platform prices in: a
      // payer paying in a currency Mayarin has no asset for would be a payment
      // nothing downstream can describe.
      const taken = await transfi.listDepositCurrencies();
      currencies = {
        at: now,
        list: taken.filter((code) => isAssetCode(code) && getAsset(code).kind === "fiat"),
      };
    }
    return c.json({ currencies: currencies.list });
  });

  app.get("/methods", async (c) => {
    const currency = c.req.query("currency") ?? "";
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new ValidationError("currency must be a three-letter code", { currency });
    }
    const methods = await client().listPaymentMethods(currency);
    return c.json({ currency, methods });
  });

  // What the payer was last told to pay, so a page that reloads — the hosted
  // TransFi page returns here — can say it is waiting instead of starting over.
  app.get("/:paymentId/funding", payerAccess(container, "paymentId"), async (c) => {
    const [latest] = await container.paymentFundings.listByPayment(c.req.param("paymentId"));
    if (latest === undefined || latest.settledAt !== null) return c.json({ funding: null });
    return c.json({
      funding: {
        methodName: latest.paymentName,
        methodLogoUrl: latest.paymentLogoUrl,
        fiatCurrency: latest.fiatCurrency,
        fiatAmount: Number(latest.fiatAmount),
      },
    });
  });

  app.post("/:paymentId/order", payerAccess(container, "paymentId"), async (c) => {
    const transfi = client();
    const paymentId = c.req.param("paymentId");

    const parsed = orderBodySchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) {
      throw new ValidationError("Invalid request", { issues: parsed.error.issues });
    }
    const body = parsed.data;

    const { intent, transaction } = await container.paymentApp.getPayment(paymentId);
    const deposit = transaction?.deposit;
    if (deposit === undefined) {
      throw new ConflictError("This payment has no deposit address yet", { paymentId });
    }

    const cryptoCurrency = transfiTokenCode(deposit.chain, deposit.asset, {
      sandbox: sandbox(),
    });
    if (cryptoCurrency === undefined) {
      throw new ValidationError("This payment's network cannot be funded with local currency", {
        chain: deposit.chain,
        asset: deposit.asset,
      });
    }

    const methods = await transfi.listPaymentMethods(body.currency);
    const method = methods.find((entry) => entry.code === body.paymentCode);
    if (method === undefined) {
      throw new ValidationError("That payment method is not available", {
        currency: body.currency,
        paymentCode: body.paymentCode,
      });
    }

    const required = Number(toDecimalString(deposit.amount));
    const { amount: fiatAmount, delivered } = await fiatAmountFor({
      required,
      probe: method.minAmount,
      decimals: FIAT_DECIMALS,
      quote: (amount) =>
        transfi
          .quote({
            fiatCurrency: body.currency,
            fiatAmount: amount,
            cryptoCurrency,
            paymentCode: method.code,
            paymentType: method.type,
          })
          .catch((error: unknown) => {
            if (error instanceof BelowMinimumError) {
              return { destinationAmount: 0, belowMinimum: error.minLimit };
            }
            throw error;
          }),
    });
    if (fiatAmount > method.maxAmount) {
      throw new ValidationError("This amount is above what that payment method allows", {
        fiatAmount,
        maxAmount: method.maxAmount,
      });
    }
    if (delivered > required * MAX_OVERPAYMENT) {
      throw new ValidationError(
        "This payment is smaller than the minimum for that method. Choose another method or pay with crypto.",
        { required, minimumDelivers: delivered },
      );
    }

    let userId: string;
    if ("payer" in body) {
      userId = await transfi.createUser(body.payer);
    } else {
      const expected = Buffer.from(sign(paymentId, body.userId));
      const received = Buffer.from(body.token);
      if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
        throw new ValidationError("This confirmation does not belong to this payment");
      }
      userId = body.userId;
    }

    const { details, missing } = detailsFor(
      method.fields,
      "payer" in body ? body.payer : body.contact,
    );
    if (missing.length > 0) {
      throw new ValidationError("That payment method asks for details we cannot collect yet", {
        paymentCode: method.code,
        missing,
      });
    }

    const userAgent = c.req.header("user-agent");
    const ip =
      c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    const device = {
      ...(userAgent === undefined ? {} : { userAgent }),
      ...(ip === undefined || ip === "" ? {} : { ip }),
    };

    // TransFi is sent the payer back to a URL with no token in it. The token
    // waits in a cookie on this browser, scoped to the one return path.
    const returnUrl = returnUrlFor(container, intent.id);
    setCookie(c, RETURN_COOKIE, container.payerTokens.mint(intent.id), {
      httpOnly: true,
      secure: c.req.url.startsWith("https:"),
      sameSite: "Lax",
      path: returnPath(intent.id),
      maxAge: RETURN_COOKIE_MAX_AGE_SECONDS,
    });
    const order = await transfi
      .createOrder({
        userId,
        // A retry must not reuse the id of an order TransFi already has.
        partnerId: `${intent.id}-${crypto.randomUUID().slice(0, 8)}`,
        fiatCurrency: body.currency,
        fiatAmount,
        paymentCode: method.code,
        paymentType: method.type,
        cryptoCurrency,
        walletAddress: deposit.address,
        successRedirectUrl: returnUrl,
        failureRedirectUrl: returnUrl,
        details,
        device,
      })
      .catch((error: unknown) => {
        if (needsVerification(error)) return undefined;
        throw error;
      });

    if (order === undefined) {
      return c.json({ status: "verification-required", userId, token: sign(paymentId, userId) });
    }

    await container.paymentFundings.record(
      {
        orderId: order.orderId,
        paymentIntentId: intent.id,
        merchantId: intent.merchant.id,
        kind: "local-currency",
        provider: "transfi",
        paymentCode: method.code,
        paymentName: method.name,
        paymentLogoUrl: method.logoUrl,
        fiatCurrency: body.currency,
        fiatAmount: fiatAmount.toFixed(2),
        status: "initiated",
        createdAt: new Date(),
      },
      new Date(),
    );

    return c.json({
      status: "created",
      orderId: order.orderId,
      payUrl: order.payUrl,
      instructions: order.instructions,
      fiatCurrency: body.currency,
      fiatAmount,
    });
  });

  return app;
}
