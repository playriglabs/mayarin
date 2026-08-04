/**
 * Admin token middleware.
 *
 * Guards the admin route group with a static bearer token. Throws
 * `UnauthorizedError` so the single error handler maps it to a 401 with the
 * `UNAUTHORIZED` code — the same taxonomy every other failure uses.
 */

import { UnauthorizedError } from "@mayarin/shared";
import type { MiddlewareHandler } from "hono";

export function adminTokenMiddleware(token: string): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.header("authorization") !== `Bearer ${token}`) {
      throw new UnauthorizedError("Invalid admin token");
    }
    await next();
  };
}
