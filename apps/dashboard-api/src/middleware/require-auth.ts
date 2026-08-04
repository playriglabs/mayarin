/**
 * Require-auth middleware.
 *
 * Turns the absence of a verified session into a 401. Place after
 * `sessionMiddleware` on any route that needs an authenticated caller.
 */

import { UnauthorizedError } from "@mayarin/shared";
import type { MiddlewareHandler } from "hono";
import type { AuthVars } from "./types.ts";

export function requireAuth(): MiddlewareHandler<{ Variables: AuthVars }> {
  return async (c, next) => {
    if (c.get("session") === undefined) {
      throw new UnauthorizedError("Authentication required");
    }
    await next();
  };
}
