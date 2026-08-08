/**
 * Audit routes — the compliance query interface (#16).
 *
 * Mounted behind `require-auth` + `payments:read`, and the merchant scope comes
 * from the verified session rather than from the query string. A caller cannot
 * name a merchant, so there is no tenant to enumerate; `ComplianceService`
 * enforces the same rule again underneath, which is deliberate — the HTTP layer
 * is not the only possible caller.
 *
 * Thin: parse query → call service → map DTO.
 */

import { ASSET_CODES, type AssetCode, UnauthorizedError } from "@mayarin/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { Container } from "../container.ts";
import { toAuditRecordDto, toAuditSummaryDto } from "../dto/audit.ts";
import type { AuthVars } from "../middleware/types.ts";

const listQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  // An unsupported asset is a 400, not an empty result — an audit that answers
  // "no payments" to a typo is a wrong answer, not a narrow one.
  asset: z.enum(ASSET_CODES as [AssetCode, ...AssetCode[]]).optional(),
  limit: z.coerce.number().int().positive().optional(),
});

export function auditRoutes(container: Container): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();

  app.get("/", async (c) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");

    const query = listQuerySchema.parse(c.req.query());
    const payments = await container.compliance.listPayments({
      merchantId: scope.merchantId,
      ...(query.from === undefined ? {} : { from: query.from }),
      ...(query.to === undefined ? {} : { to: query.to }),
      ...(query.asset === undefined ? {} : { asset: query.asset }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    });

    return c.json({ payments: payments.map(toAuditSummaryDto) });
  });

  app.get("/:id", async (c) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");

    const record = await container.compliance.record(scope.merchantId, c.req.param("id"));
    return c.json(toAuditRecordDto(record));
  });

  return app;
}
