/**
 * A withdrawal's gas, priced in the token being withdrawn.
 *
 * The wallet provider knows the gas as native wei; the merchant is moving a
 * stablecoin. The payment API's own quote layer is the price source, so this is
 * the same native rate a payer paying in the chain's currency would be locked
 * to, and the figure cannot disagree with what a payment on that chain costs.
 */

import type { ChainId } from "@mayarin/chain";
import { type AssetCode, assetDecimals, ProviderError } from "@mayarin/shared";
import type { PaymentApiClient } from "./services/payment-api-client.ts";
import { DOLLAR_STABLECOINS, USD_RATE_SCALE, usdRates } from "./usd.ts";

/** Every EVM chain's native currency, Arc's USDC included, has 18 decimals. */
const NATIVE_DECIMALS = 18n;

export type GasFeePricer = (input: {
  readonly cost: bigint;
  readonly asset: AssetCode;
}) => Promise<bigint>;

/**
 * Prices `cost` wei of `gasAsset` in `asset`'s minor units, rounded up so the
 * operator is never left short by the rounding.
 *
 * Throws rather than guessing when either leg has no rate: a withdrawal whose
 * fee cannot be named does not run for free, it does not run.
 */
export function gasFeePricer(
  paymentApi: PaymentApiClient,
  chain: ChainId,
  gasAsset: AssetCode,
): GasFeePricer {
  return async ({ cost, asset }) => {
    // How much of the gas currency one dollar buys on this chain. A dollar
    // stablecoin is a dollar, so a chain that burns one (Arc) needs no quote.
    const perDollar = DOLLAR_STABLECOINS.has(gasAsset)
      ? 10n ** NATIVE_DECIMALS
      : await quotedPerDollar(paymentApi, chain, gasAsset, asset);

    const rate = (await usdRates({ paymentApi }, [asset]))[asset];
    if (rate === undefined) {
      throw new ProviderError(`No USD rate for ${asset} to price the network fee on ${chain}`, {
        chain,
        asset,
      });
    }

    const numerator = cost * USD_RATE_SCALE * 10n ** BigInt(assetDecimals(asset));
    const denominator = perDollar * BigInt(rate);
    return (numerator + denominator - 1n) / denominator;
  };
}

async function quotedPerDollar(
  paymentApi: PaymentApiClient,
  chain: ChainId,
  gasAsset: AssetCode,
  settlementAsset: AssetCode,
): Promise<bigint> {
  const view = await paymentApi.quote(
    { amount: "1", asset: "USD" },
    [gasAsset],
    chain,
    settlementAsset,
  );
  const perDollar = view.quotes.find((line) => line.asset === gasAsset)?.amount?.amount;
  if (perDollar === undefined || BigInt(perDollar) <= 0n) {
    throw new ProviderError(`No ${gasAsset} rate to price the network fee on ${chain}`, {
      chain,
      gasAsset,
    });
  }
  return BigInt(perDollar);
}
