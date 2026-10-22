import { type AssetCode, UnauthorizedError } from "@mayarin/shared";
import { Hono } from "hono";
import type { Container } from "../container.ts";
import { toPaymentIntentDto } from "../dto/payment.ts";
import { toSettlementDto } from "../dto/settlement.ts";
import type { AuthVars } from "../middleware/types.ts";
import { displayCurrencyOf, usdRates } from "../usd.ts";

export function analyticsRoutes(container: Container): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();

  app.get("/", async (c) => {
    const scope = c.get("scope");
    if (scope === undefined) throw new UnauthorizedError("Authentication required");
    const [payments, settlements] = await Promise.all([
      container.payments.listAll(scope),
      container.settlements.listAll(scope),
    ]);
    // Settlements land in several assets (USDC, USDG, EURC…); the pay-out
    // figures are read in dollars, at the same rates the wallet balance uses.
    const assets = [
      ...new Set(
        settlements.flatMap(({ transaction }) =>
          transaction.netAmount === undefined ? [] : [transaction.netAmount.asset as AssetCode],
        ),
      ),
    ];
    return c.json({
      display: await displayCurrencyOf(container, scope),
      payments: payments.map(toPaymentIntentDto),
      settlements: settlements.map(toSettlementDto),
      usdRates: await usdRates(container, assets),
    });
  });

  return app;
}
