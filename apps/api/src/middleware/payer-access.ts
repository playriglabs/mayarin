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

export function payerAccess(container: Container, param = "id"): MiddlewareHandler {
  return async (c, next) => {
    const id = c.req.param(param) ?? "";
    const token = c.req.query("t") ?? c.req.header("x-payer-token");
    if (container.payerTokens.verify(id, token)) return next();
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
