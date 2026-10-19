import { type AssetCode, UnauthorizedError } from "@mayarin/shared";
import { Hono } from "hono";
import type { Container } from "../container.ts";
import { toPaymentIntentDto } from "../dto/payment.ts";
import { toSettlementDto } from "../dto/settlement.ts";
import type { AuthVars } from "../middleware/types.ts";
import { usdRates } from "../usd.ts";

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
    // What one US dollar buys in the merchant's display currency. A merchant on
    // dollars, or a rate table that cannot be read, gets 1: the dashboard then
    // shows dollars rather than a number nobody can stand behind.
    const currency = (await container.settings.get(scope)).displayCurrency ?? "USD";
    const perUsd = currency === "USD" ? undefined : await container.displayRates.perUsd(currency);
    return c.json({
      display: perUsd === undefined ? { currency: "USD", perUsd: "1" } : { currency, perUsd },
      payments: payments.map(toPaymentIntentDto),
      settlements: settlements.map(toSettlementDto),
      usdRates: await usdRates(container, assets),
    });
  });

  return app;
}
