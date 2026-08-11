/**
 * CSRF middleware.
 *
 * Double-submit token, defence-in-depth on top of `SameSite=Strict`. Mutating
 * methods must echo the session's CSRF token in the `X-CSRF-Token` header; the
 * browser reads it from the non-httpOnly `mayarin_csrf` cookie we set at login.
 * A mismatched or absent header is a 403. Safe methods pass through untouched.
 *
 * A bearer-token (API key) request is exempt: a browser does not auto-send an
 * `Authorization` header cross-origin, so the cross-site request the token
 * defends against cannot be forged against one. The `requireAuth` check still
 * applies — exemption is from the CSRF check, not from authentication.
 */

import { ForbiddenError, UnauthorizedError } from "@mayarin/shared";
import type { MiddlewareHandler } from "hono";
import { CSRF_HEADER } from "../dto/auth.ts";
import type { AuthVars } from "./types.ts";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function csrfMiddleware(): MiddlewareHandler<{ Variables: AuthVars }> {
  return async (c, next) => {
    if (!MUTATING.has(c.req.method)) {
      await next();
      return;
    }
    // A bearer request carries no session cookie and no CSRF token; the threat
    // model for CSRF does not apply to it, so it passes through.
    if (c.get("authMethod") === "api-key") {
      await next();
      return;
    }
    const verified = c.get("session");
    if (verified === undefined) {
      // No verified session on a mutating request: that is an auth concern, not
      // a CSRF one — surface it as 401 so the client knows to re-authenticate.
      throw new UnauthorizedError("Authentication required");
    }
    const token = c.req.header(CSRF_HEADER);
    if (token === undefined || token !== verified.session.csrfToken) {
      throw new ForbiddenError("Invalid CSRF token");
    }
    await next();
  };
}
