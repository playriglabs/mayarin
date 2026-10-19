/**
 * Who may act on one payment by its id (SEC-09).
 *
 * Three callers, each with its own proof:
 * - the payer, holding the token minted with the payment (`?t=` or `x-payer-token`);
 * - the merchant that owns it, holding an API key;
 * - the dashboard API, holding the shared internal token.
 *
 * Everyone else gets a 404, the same answer as for a payment that does not
 * exist, so the route is no oracle for which ids are real.
 */

import { timingSafeEqual } from "node:crypto";
import { NotFoundError } from "@mayarin/shared";
import type { MiddlewareHandler } from "hono";
import type { Container } from "../container.ts";

const BEARER_PREFIX = "bearer ";

/**
 * Set on a request that got in with the payer's token and nothing stronger. Such
 * a caller sees what it takes to pay, not the operational record of the payment.
 */
export const PAYER_CALLER = "payerCaller";

export function payerAccess(container: Container, param = "id"): MiddlewareHandler {
  return async (c, next) => {
    const id = c.req.param(param) ?? "";
    const token = c.req.query("t") ?? c.req.header("x-payer-token");
    if (container.payerTokens.verify(id, token)) {
      c.set(PAYER_CALLER, true);
      return next();
    }
    if (isInternal(container, c.req.header("x-internal-token"))) return next();
    if (await ownsPayment(container, id, c.req.header("authorization"))) return next();
    throw new NotFoundError(`Payment ${id} not found`, { id });
  };
}

function isInternal(container: Container, presented: string | undefined): boolean {
  const expected = container.config.internalApiToken;
  if (expected === undefined || presented === undefined) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(presented);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function ownsPayment(
  container: Container,
  id: string,
  authorization: string | undefined,
): Promise<boolean> {
  if (authorization === undefined || !authorization.toLowerCase().startsWith(BEARER_PREFIX)) {
    return false;
  }
  const secret = authorization.slice(BEARER_PREFIX.length).trim();
  const scope = secret === "" ? null : await container.verifyApiKey(secret);
  if (scope === null || scope.kind === "publishable") return false;
  const intent = await container.intents.getById(id).catch(() => undefined);
  return intent?.ownerMerchantId === scope.merchantId;
}

/** The buyer URL and token for a payment, returned to whoever created it. */
export function payerAccessFor(container: Container, paymentId: string) {
  const payerToken = container.payerTokens.mint(paymentId);
  return {
    payerToken,
    checkoutUrl: `${container.config.checkoutBaseUrl}/checkout/pay/${encodeURIComponent(paymentId)}?t=${payerToken}`,
  };
}

/** Where a payer who leaves for a third party is sent back, and the cookie that lets them in. */
export const RETURN_COOKIE = "mayarin_return";
export const RETURN_COOKIE_MAX_AGE_SECONDS = 3_600;

export const returnPath = (paymentId: string): string =>
  `/checkout/return/${encodeURIComponent(paymentId)}`;

/**
 * The URL a third party (TransFi) redirects the payer to. It carries no
 * capability: the token travels in an HttpOnly cookie set on the payer's own
 * browser, so the third party, its logs and its referrers never see it.
 */
export const returnUrlFor = (container: Container, paymentId: string): string =>
  `${container.config.checkoutBaseUrl}${returnPath(paymentId)}`;
