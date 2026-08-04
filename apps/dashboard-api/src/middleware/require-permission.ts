/**
 * Require-permission middleware.
 *
 * Guards a route group on a single `Permission`. A caller whose session exists
 * but whose scope does not carry the permission gets a 403; a caller with no
 * session at all gets a 401 (from `require-auth`, which runs first). Every
 * account is merchant-scoped — permissions gate surfaces within that merchant,
 * never cross-merchant.
 */

import type { Permission } from "@mayarin/auth";
import { ForbiddenError } from "@mayarin/shared";
import type { MiddlewareHandler } from "hono";
import type { AuthVars } from "./types.ts";

export function requirePermission(permission: Permission): MiddlewareHandler<{
  Variables: AuthVars;
}> {
  return async (c, next) => {
    const scope = c.get("scope");
    if (scope === undefined || !scope.permissions.has(permission)) {
      // Missing scope is a wiring error (require-auth should have run first);
      // a present scope without the permission is a legit 403.
      throw new ForbiddenError(`Missing permission: ${permission}`);
    }
    await next();
  };
}
