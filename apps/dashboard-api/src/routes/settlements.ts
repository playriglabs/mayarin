/**
 * Settlement routes (#15).
 *
 * A read of the merchant's own payouts. Mounted behind `require-auth` +
 * `requirePermission("payments:read")`: this is a deeper view of the payments
 * the caller can already see, not a wider one.
 */

import { type AssetCode, type Money, money, UnauthorizedError } from "@mayarin/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { Container } from "../container.ts";
import { toMoneyDto } from "../dto/money.ts";
import { toSettlementDto, toSettlementSummaryDto } from "../dto/settlement.ts";
import type { AuthVars } from "../middleware/types.ts";
import { toUsd, usdRates } from "../usd.ts";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().optional(),
  cursor: z.string().min(1).optional(),
});

export function settlementRoutes(container: Container): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();

  app.get("/", async (c) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");
    const { limit, cursor } = listQuerySchema.parse(c.req.query());
    const result = await container.settlements.listWithSummary(scope, limit, cursor);
    // One dollar figure across every settlement asset (USDC, USDG, PYUSD, EURC…).
    // An asset with no rate is named rather than silently left out of the sum.
    const totals = result.summary.totals;
    const rates = await usdRates(
      container,
      totals.map((total) => total.netAmount.asset as AssetCode),
    );
    const inUsd = (pick: (total: (typeof totals)[number]) => Money) =>
      totals.reduce((sum, total) => sum + (toUsd(pick(total), rates)?.amount ?? 0n), 0n);
    return c.json({
      settlements: result.rows.map(toSettlementDto),
      summary: {
        ...toSettlementSummaryDto(result.summary),
        usd: {
          netAmount: toMoneyDto(
            money(
              inUsd((total) => total.netAmount),
              "USD",
            ),
          ),
          fee: toMoneyDto(
            money(
              inUsd((total) => total.fee),
              "USD",
            ),
          ),
          unpriced: totals
            .map((total) => total.netAmount.asset)
            .filter((asset) => rates[asset] === undefined),
        },
      },
      nextCursor: result.nextCursor,
    });
  });

  return app;
}
