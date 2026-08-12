/**
 * API-key (bearer) auth for the merchant surface (#14).
 *
 * The payment API has two kinds of caller. A buyer follows a link, pays an
 * invoice, confirms a checkout — those routes stay open, guarded only by
 * unguessable ids. A merchant (or their POS / integration) creates intents,
 * products, links and invoices — those routes require a key minted on the
 * dashboard (`/api-keys`).
 *
 * A missing secret and an unknown one produce the same 401, so a revoked key
 * does not learn that it once existed — the same posture the dashboard takes.
 */

import type { ApiKeyKind, Permission } from "@mayarin/auth";
import { ForbiddenError, UnauthorizedError } from "@mayarin/shared";
import type { MiddlewareHandler } from "hono";

export interface ApiKeyScope {
  readonly merchantId: string;
  readonly kind: ApiKeyKind;
  readonly permissions: ReadonlySet<Permission>;
}

/** Resolves a bearer secret to the scope its key grants, or `null` for no match. */
export type ApiKeyVerifier = (secret: string) => Promise<ApiKeyScope | null>;

/** Hono environment for route groups that read the verified scope. */
export interface ApiKeyAuthEnv {
  readonly Variables: { scope: ApiKeyScope };
}

const BEARER_PREFIX = "bearer ";

/**
 * Requires a valid **secret** bearer key, and optionally one specific
 * permission on it. On success the key's scope is set on the context for the
 * handler to read.
 *
 * A publishable key is refused with a 403 that names the reason: the caller
 * holds the key, so there is nothing to hide, and "requires a secret key" is
 * the sentence that fixes their integration (#113).
 */
export function requireApiKey(
  verify: ApiKeyVerifier,
  permission?: Permission,
): MiddlewareHandler<ApiKeyAuthEnv> {
  return async (c, next) => {
    const scope = await verifyBearer(c.req.header("authorization"), verify);

    if (scope.kind === "publishable") {
      throw new ForbiddenError("This route requires a secret key", {});
    }
    if (permission !== undefined && !scope.permissions.has(permission)) {
      throw new ForbiddenError(`This API key does not grant ${permission}`, { permission });
    }

    c.set("scope", scope);
    await next();
  };
}

/**
 * The publishable surface (#113): catalog read and cart checkout. Accepts a
 * publishable key, and a secret key too — a secret key is strictly stronger,
 * and a server-side integration must not need a second key for the read path.
 */
export function requirePublishableKey(verify: ApiKeyVerifier): MiddlewareHandler<ApiKeyAuthEnv> {
  return async (c, next) => {
    c.set("scope", await verifyBearer(c.req.header("authorization"), verify));
    await next();
  };
}

async function verifyBearer(
  header: string | undefined,
  verify: ApiKeyVerifier,
): Promise<ApiKeyScope> {
  if (header === undefined || !header.toLowerCase().startsWith(BEARER_PREFIX)) {
    throw new UnauthorizedError("This route requires an API key");
  }
  const secret = header.slice(BEARER_PREFIX.length).trim();
  const scope = secret === "" ? null : await verify(secret);
  if (scope === null) {
    throw new UnauthorizedError("This route requires an API key");
  }
  return scope;
}

/**
 * The request body names a merchant; the key must belong to that merchant.
 * A mismatch is a 403 rather than a 404 — the caller named the merchant
 * themselves, so there is nothing to hide.
 */
export function assertMerchant(scope: ApiKeyScope, merchantId: string): void {
  if (scope.merchantId !== merchantId) {
    throw new ForbiddenError("This API key belongs to another merchant", {});
  }
}
