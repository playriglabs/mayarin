/**
 * API key routes — merchant bearer tokens.
 *
 * Mounted behind `require-auth` + `requirePermission("settings:manage")`. A key
 * decides what a third-party integration can reach within this merchant, which
 * is the same perimeter as settlement settings, so the same permission gates it.
 * Mutating routes carry `csrfMiddleware`, which passes a bearer request through
 * unchanged (see `csrf.ts`).
 */

import { UnauthorizedError } from "@mayarin/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { Container } from "../container.ts";
import { createApiKeyBodySchema, toApiKeyDto } from "../dto/api-keys.ts";
import { csrfMiddleware } from "../middleware/csrf.ts";
import type { AuthVars } from "../middleware/types.ts";

const listQuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  sort: z.enum(["created", "-created"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export function apiKeyRoutes(container: Container): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();

  const scopeOf = (c: { get: (key: "scope") => AuthVars["scope"] }) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");
    return scope;
  };

  app.get("/", async (c) => {
    const query = listQuerySchema.parse(c.req.query());
    const keys = await container.apiKeys.list(scopeOf(c), {
      ...(query.q === undefined ? {} : { q: query.q }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.sort === undefined ? {} : { sort: query.sort }),
      ...(query.from === undefined ? {} : { from: query.from }),
      ...(query.to === undefined ? {} : { to: query.to }),
    });
    return c.json({ apiKeys: keys.map(toApiKeyDto) });
  });

  app.post("/", csrfMiddleware(), async (c) => {
    const scope = scopeOf(c);
    const body = createApiKeyBodySchema.parse(await c.req.json());
    const { key, secret } = await container.apiKeys.create(scope, {
      name: body.name,
      ...(body.kind === undefined ? {} : { kind: body.kind }),
      permissions: body.permissions ?? [],
    });
    return c.json({ apiKey: toApiKeyDto(key), secret }, 201);
  });

  app.delete("/:id", csrfMiddleware(), async (c) => {
    const key = await container.apiKeys.deactivate(scopeOf(c), c.req.param("id"));
    return c.json({ apiKey: toApiKeyDto(key) });
  });

  return app;
}
