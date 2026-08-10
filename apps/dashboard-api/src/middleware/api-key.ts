/**
 * API-key (bearer) middleware.
 *
 * Runs after `sessionMiddleware` and before the route groups. A request that
 * already has a verified session is left alone — a browser carrying its cookie
 * is the session path, and a request that is both is a session request. Only a
 * request with no session and an `Authorization: Bearer <secret>` header is
 * authenticated here: the secret is hashed and looked up, and on a match the
 * key's merchant + permissions become the request's `scope`.
 *
 * A missing or unknown bearer is not a failure: the request continues without a
 * scope, and `require-auth` decides whether that matters. That keeps the error
 * shape identical to an unauthenticated browser request — a revoked key does
 * not learn that it once existed.
 */

import type { MiddlewareHandler } from "hono";
import type { ApiKeyService } from "../services/api-key-service.ts";
import type { AuthVars } from "./types.ts";

const BEARER_PREFIX = "bearer ";

export function apiKeyMiddleware(apiKeys: ApiKeyService): MiddlewareHandler<{
  Variables: AuthVars;
}> {
  return async (c, next) => {
    // A session already verified by the cookie middleware wins; do not overlay a
    // bearer scope on top of it.
    if (c.get("scope") !== undefined) {
      await next();
      return;
    }

    const header = c.req.header("authorization");
    if (header === undefined) {
      await next();
      return;
    }
    if (!header.toLowerCase().startsWith(BEARER_PREFIX)) {
      await next();
      return;
    }

    const secret = header.slice(BEARER_PREFIX.length).trim();
    if (secret === "") {
      await next();
      return;
    }

    const scope = await apiKeys.verifySecret(secret);
    if (scope !== null) {
      c.set("scope", scope);
      c.set("authMethod", "api-key");
    }

    await next();
  };
}
