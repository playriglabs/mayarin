/**
 * Exact money derivations shared by the Overview and Analytics pages.
 *
 * A completed payment can be priced in any supported fiat currency. Those
 * source amounts cannot be added directly, so the USD pay-in view uses the
 * gross settlement amount frozen when the payment was price-locked. For a
 * dollar settlement asset that is the historical USD equivalent of the source
 * amount; using it avoids both a live FX lookup and a dashboard-only rate.
 */

import { assetDecimals, isAssetCode } from "@mayarin/shared/asset";
import type { PaymentIntentDto } from "@/types/payment";
import type { SettlementDto } from "@/types/settlement";

const USD_SETTLEMENT_ASSETS: ReadonlySet<string> = new Set(["USDC", "USDT"]);

function rescaleToUsd(amount: bigint, asset: string): bigint | null {
  if (!isAssetCode(asset) || !USD_SETTLEMENT_ASSETS.has(asset)) return null;

  const decimalDifference = assetDecimals(asset) - assetDecimals("USD");
  if (decimalDifference <= 0) return amount * 10n ** BigInt(-decimalDifference);

  const divisor = 10n ** BigInt(decimalDifference);
  return (amount + divisor / 2n) / divisor;
}

/**
 * A completed payment expressed in USD minor units.
 *
 * USD-priced payments retain their exact source amount. Other fiat prices use
 * the gross (pre-fee) dollar-settlement amount locked for that same payment.
 * `null` means there is no honest USD value in the data, so callers omit the
 * amount rather than adding unlike currencies.
 */
export function payInAmountUsd(
  payment: PaymentIntentDto,
  settlement: SettlementDto | undefined,
): bigint | null {
  if (payment.status !== "COMPLETED") return null;
  if (payment.amount.asset === "USD") return BigInt(payment.amount.amount);
  if (
    settlement === undefined ||
    settlement.paymentIntentId !== payment.id ||
    (settlement.state !== "SUCCESS" && settlement.state !== "SETTLED") ||
    settlement.settlementAmount === null
  ) {
    return null;
  }

  return rescaleToUsd(
    BigInt(settlement.settlementAmount.amount),
    settlement.settlementAmount.asset,
  );
}

export function settlementsByPaymentIntent(
  settlements: readonly SettlementDto[],
): ReadonlyMap<string, SettlementDto> {
  return new Map(settlements.map((settlement) => [settlement.paymentIntentId, settlement]));
}
