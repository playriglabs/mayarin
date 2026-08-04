/**
 * Admin routes — surfaces within the caller's own merchant.
 *
 * Mounted behind `require-auth` + `requirePermission("admin:access")`, so the
 * scope always carries a `merchantId`. There is no cross-merchant view: every
 * response is scoped to the caller's merchant. `POST /admin/users` additionally
 * requires `users:manage` (checked in-handler) and creates a sub-account in the
 * same merchant only.
 */

import { ForbiddenError, UnauthorizedError } from "@mayarin/shared";
import { Hono } from "hono";
import type { Container } from "../container.ts";
import { type CreateUserBody, createUserBodySchema, toUserDto } from "../dto/auth.ts";
import { csrfMiddleware } from "../middleware/csrf.ts";
import type { AuthVars } from "../middleware/types.ts";

export function adminRoutes(container: Container): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();

  // List the accounts in the caller's merchant.
  app.get("/users", async (c) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");
    const users = await container.users.listMerchantUsers(scope.merchantId);
    return c.json({ users: users.map(toUserDto) });
  });

  // Grant a sub-account in the caller's own merchant (needs `users:manage`).
  // CSRF-guarded like logout: a state-changing POST must echo the double-submit
  // token, so a forged cross-site form cannot mint accounts.
  app.post("/users", csrfMiddleware(), async (c) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");
    if (!scope.permissions.has("users:manage")) {
      throw new ForbiddenError("Missing permission: users:manage");
    }
    const body = createUserBodySchema.parse(await c.req.json()) as CreateUserBody;
    const result = await container.users.createMerchantUser({
      actorMerchantId: scope.merchantId,
      email: body.email,
      ...(body.password === undefined ? {} : { password: body.password }),
      permissions: body.permissions,
    });
    return c.json(
      {
        user: toUserDto(result.user),
        ...(result.password === undefined ? {} : { generatedPassword: result.password }),
      },
      201,
    );
  });

  return app;
}
