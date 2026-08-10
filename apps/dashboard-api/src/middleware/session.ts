/**
 * Session middleware.
 *
 * Reads the session cookie, asks `SessionService.verify` for the authoritative
 * verdict, and stamps `session`/`scope` on the request context. A cookie that
 * fails verification (unknown, revoked, expired) is treated as no session and
 * the request continues — `require-auth` is what decides whether that matters.
 * Any other failure (e.g. a database error) propagates to the error handler.
 */

import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { SESSION_COOKIE, scopeOf } from "../dto/auth.ts";
import { runEffectOrUnauthorized } from "../effect.ts";
import type { SessionService } from "../services/session-service.ts";
import type { AuthVars } from "./types.ts";

export function sessionMiddleware(
  sessions: SessionService,
): MiddlewareHandler<{ Variables: AuthVars }> {
  return async (c, next) => {
    const sessionId = getCookie(c, SESSION_COOKIE);
    if (sessionId === undefined) {
      await next();
      return;
    }

    // An expired/revoked/unknown cookie is not a request failure: drop the
    // session and let the route's auth requirement decide the response. Any other
    // failure (e.g. a database error) propagates to the error handler.
    const verified = await runEffectOrUnauthorized(sessions.verify(sessionId));
    if (verified !== null) {
      c.set("session", verified);
      c.set("scope", scopeOf(verified.user));
      c.set("authMethod", "session");
    }

    await next();
  };
}
