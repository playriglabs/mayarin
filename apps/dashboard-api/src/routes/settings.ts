/**
 * Merchant settings routes (#95).
 *
 * Mounted behind `require-auth` + `requirePermission("settings:manage")`. The
 * merchant being read or written is always the one on the session — no route
 * here takes a merchant id, so there is nothing to tamper with.
 */

import { UnauthorizedError } from "@mayarin/shared";
import { Hono } from "hono";
import type { Container } from "../container.ts";
import {
  historyQuerySchema,
  toSettingChangeDto,
  toSettingsDto,
  updateSettingsBodySchema,
} from "../dto/settings.ts";
import { csrfMiddleware } from "../middleware/csrf.ts";
import type { AuthVars } from "../middleware/types.ts";

export function settingsRoutes(container: Container): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();

  app.get("/", async (c) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");
    return c.json({ settings: toSettingsDto(await container.settings.get(scope)) });
  });

  // CSRF-guarded like every other state-changing route: this one decides where
  // the merchant's money is paid, so a forged cross-site form must not reach it.
  app.patch("/", csrfMiddleware(), async (c) => {
    const scope = c.get("scope");
    const session = c.get("session");
    if (scope === undefined || session === undefined) {
      throw new UnauthorizedError("Authentication required");
    }

    const body = updateSettingsBodySchema.parse(await c.req.json());
    const { merchant, changes } = await container.settings.update(scope, session.user.id, {
      ...(body.settlementAsset === undefined ? {} : { settlementAsset: body.settlementAsset }),
      ...(body.acceptedAssets === undefined ? {} : { acceptedAssets: body.acceptedAssets }),
      ...(body.settlementAddress === undefined
        ? {}
        : { settlementAddress: body.settlementAddress }),
    });

    return c.json({
      settings: toSettingsDto(merchant),
      changes: changes.map(toSettingChangeDto),
    });
  });

  /** Who changed what, and when. Scoped to the caller's own merchant. */
  app.get("/history", async (c) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");
    const { limit } = historyQuerySchema.parse(c.req.query());
    const changes = await container.settings.history(scope, limit);
    return c.json({ changes: changes.map(toSettingChangeDto) });
  });

  return app;
}
