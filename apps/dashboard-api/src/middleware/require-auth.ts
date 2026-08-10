/**
 * Require-auth middleware.
 *
 * Turns the absence of an authenticated scope into a 401. Both the session
 * middleware (cookie) and the API-key middleware (bearer token) set `scope`, so
 * this authenticates either one — a route behind `requireAuth` is reachable
 * from a logged-in browser and from a merchant's API key alike. Place after
 * both middlewares on any route that needs an authenticated caller.
 */

import { UnauthorizedError } from "@mayarin/shared";
import type { MiddlewareHandler } from "hono";
import type { AuthVars } from "./types.ts";

export function requireAuth(): MiddlewareHandler<{ Variables: AuthVars }> {
  return async (c, next) => {
    if (c.get("scope") === undefined) {
      throw new UnauthorizedError("Authentication required");
    }
    await next();
  };
}
