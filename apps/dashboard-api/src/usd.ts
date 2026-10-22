/**
 * Stablecoins in dollars, for figures a merchant reads as one number.
 *
 * A dollar stablecoin is 1; anything else (EURC) is priced through the payment
 * API's own fiat leg, the same rate a payment would lock. Shared by the wallet
 * balance and the settlement summary so both say the same dollar amount.
 */

import { type AssetCode, assetDecimals, type Money, money } from "@mayarin/shared";
import type { Container } from "./container.ts";

/** Stablecoins that are a dollar in another representation: valued 1:1. */
export const DOLLAR_STABLECOINS: ReadonlySet<string> = new Set(["USDC", "USDT", "USDG", "PYUSD"]);

/** `usdRates` values are USD per one whole token, scaled by this. */
export const USD_RATE_SCALE = 1_000_000n;

/**
 * USD per one whole token, scaled by `USD_RATE_SCALE`, for each stablecoin held.
 *
 * So the balance can be read in dollars. A dollar stablecoin is 1; anything else
 * (EURC) is priced through the payment API's own fiat leg, the same rate a
 * payment would lock. An asset that cannot be priced is left out, and the
 * dashboard leaves it out of the total rather than guessing.
 */
export async function usdRates(
  container: Pick<Container, "paymentApi">,
  assets: readonly AssetCode[],
): Promise<Record<string, string>> {
  const rates: Record<string, string> = {};
  const priced = assets.filter((asset) => !DOLLAR_STABLECOINS.has(asset));
  for (const asset of assets) {
    if (DOLLAR_STABLECOINS.has(asset)) rates[asset] = USD_RATE_SCALE.toString();
  }
  await Promise.all(
    priced.map(async (asset) => {
      try {
        // Settling in the asset itself, so only the fiat leg is priced: how much
        // of it one dollar buys.
        const view = await container.paymentApi.quote(
          { amount: "1", asset: "USD" },
          [asset],
          undefined,
          asset,
        );
        const perDollar = view.quotes.find((line) => line.asset === asset)?.amount?.amount;
        if (perDollar === undefined || BigInt(perDollar) <= 0n) return;
        rates[asset] = (
          (USD_RATE_SCALE * 10n ** BigInt(assetDecimals(asset))) /
          BigInt(perDollar)
        ).toString();
      } catch {
        // No rate: the asset stays out of the dollar total.
      }
    }),
  );
  return rates;
}

/**
 * `value` in US cents, or `undefined` when its asset has no rate.
 *
 * Rounded half-up to the cent: a summary figure, never an amount anything pays.
 */
export function toUsd(value: Money, rates: Readonly<Record<string, string>>): Money | undefined {
  const rate = rates[value.asset];
  if (rate === undefined) return undefined;
  const numerator = value.amount * BigInt(rate) * 10n ** BigInt(assetDecimals("USD"));
  const denominator = USD_RATE_SCALE * 10n ** BigInt(assetDecimals(value.asset));
  return money((numerator * 2n + denominator) / (denominator * 2n), "USD");
}

/**
 * What one US dollar buys in the merchant's display currency. A merchant on dollars, or a rate
 * table that cannot be read, gets 1: the dashboard then shows dollars rather than a number nobody
 * can stand behind.
 */
export async function displayCurrencyOf(
  container: Pick<Container, "settings" | "displayRates">,
  scope: Parameters<Container["settings"]["get"]>[0],
): Promise<{ readonly currency: string; readonly perUsd: string }> {
  const currency = (await container.settings.get(scope)).displayCurrency ?? "USD";
  const perUsd = currency === "USD" ? undefined : await container.displayRates.perUsd(currency);
  return perUsd === undefined ? { currency: "USD", perUsd: "1" } : { currency, perUsd };
}
