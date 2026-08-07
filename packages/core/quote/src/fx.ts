/**
 * The fiat leg of a quote (RFC #6 — #59).
 *
 * A merchant prices in their local currency: IDR 35.000 for a coffee. Turning
 * that into a settlement stablecoin is a **foreign-exchange conversion**, and no
 * swap venue can serve it — there is no IDR pool on any DEX. LiFi, 0x and
 * Uniswap all price crypto against crypto, so `SwapVenue.quote("IDR", …)` has no
 * answer. This leg therefore has an oracle and no venue, which also means the
 * deviation guard (venue checked against oracle) has nothing to compare and does
 * not apply here.
 *
 * What guards it instead is staleness plus, where the pair allows it, not
 * needing a rate at all:
 *
 * - **Pegged pairs** convert by construction. IDR into IDRX is the same currency
 *   in two representations, so it is a decimal rescale, not an exchange rate —
 *   routing it through USD would introduce two rounding steps and two sources of
 *   error to answer a question that has an exact answer.
 * - **Everything else** reads an oracle reference and refuses a stale one.
 *
 * Rounding is always *up*, so the settlement amount never lands below the price
 * the merchant asked for. The merchant's `minOut` is a hard lock downstream; a
 * cent lost here would be a cent the merchant silently never receives.
 */

import { assertFresh, type OraclePrice, type PriceOracle } from "@mayarin/clearing";
import {
  type AssetCode,
  assetDecimals,
  ConfigurationError,
  getAsset,
  type Money,
  money,
  RATE_SCALE,
  ValidationError,
} from "@mayarin/shared";

/** How the settlement amount was derived — the audit trail for a lock. */
export type FiatRateKind = "pegged" | "oracle";

/** A merchant's fiat price, converted into the asset they settle in. */
export interface SettlementPrice {
  /** What the merchant asked for, e.g. IDR 35.000,00. */
  readonly price: Money;
  /** The same value in the settlement asset, rounded up. */
  readonly settlementAmount: Money;
  readonly kind: FiatRateKind;
  /** `"peg"` for a pegged pair, otherwise the oracle's source name. */
  readonly source: string;
  /** Present only for `"oracle"`; a pegged pair has nothing to go stale. */
  readonly observedAt?: Date;
}

export interface FiatPricePolicy {
  /**
   * Pairs that are the same currency in two representations, as
   * `"IDR/IDRX"`. Declared by the deployment, never inferred: whether a
   * stablecoin actually holds its peg is a judgement about an issuer, not
   * something this package can decide from an asset code.
   */
  readonly pegged: readonly string[];
  /** Oldest tolerated oracle observation, in milliseconds. */
  readonly maxAgeMs: number;
}

/** `"IDR/IDRX"` — the same key shape the rate table and oracle feeds use. */
export function fiatPairKey(from: AssetCode, to: AssetCode): string {
  return `${from}/${to}`;
}

/**
 * Converts a merchant's fiat price into the asset they settle in.
 *
 * `price` must be fiat and `settlementAsset` a stablecoin: this is the leg that
 * crosses that boundary, and crossing it in the wrong direction (or not at all)
 * is a configuration mistake worth failing loudly on rather than quietly
 * producing a number.
 */
export async function priceInSettlement(
  oracle: PriceOracle,
  price: Money,
  settlementAsset: AssetCode,
  policy: FiatPricePolicy,
  now: Date,
): Promise<SettlementPrice> {
  if (getAsset(price.asset).kind !== "fiat") {
    throw new ConfigurationError(
      `The fiat leg needs a fiat price, got ${price.asset} (${getAsset(price.asset).kind})`,
      { priceAsset: price.asset },
    );
  }
  if (getAsset(settlementAsset).kind !== "stablecoin") {
    throw new ConfigurationError(
      `A merchant settles in a stablecoin, not ${settlementAsset} (${getAsset(settlementAsset).kind})`,
      { settlementAsset },
    );
  }
  if (price.amount <= 0n) {
    throw new ValidationError("A merchant price must be positive", {
      price: price.amount.toString(),
    });
  }

  if (policy.pegged.includes(fiatPairKey(price.asset, settlementAsset))) {
    return {
      price,
      settlementAmount: rescale(price, settlementAsset),
      kind: "pegged",
      source: "peg",
    };
  }

  const reference: OraclePrice = await oracle.reference(price.asset, settlementAsset);
  assertFresh(reference, policy.maxAgeMs, now);

  return {
    price,
    settlementAmount: convertCeil(price, settlementAsset, reference.scaledRate),
    kind: "oracle",
    source: reference.source,
    observedAt: reference.observedAt,
  };
}

/**
 * Rescales between two representations of the same currency. Purely a decimal
 * shift: IDR 35.000,00 (2 dp) is 35.000,00 IDRX (2 dp) — the same number of
 * minor units. Scaling up is exact; scaling down rounds up, so the merchant is
 * never short.
 */
function rescale(value: Money, target: AssetCode): Money {
  const from = assetDecimals(value.asset);
  const to = assetDecimals(target);
  if (to >= from) {
    return money(value.amount * 10n ** BigInt(to - from), target);
  }
  const divisor = 10n ** BigInt(from - to);
  return money((value.amount + divisor - 1n) / divisor, target);
}

/**
 * `convert` with a ceiling. `@mayarin/shared`'s `convert` rounds half-up, which
 * can land a minor unit below the merchant's price; here the direction has to be
 * one-way.
 */
function convertCeil(value: Money, target: AssetCode, scaledRate: bigint): Money {
  if (scaledRate <= 0n) {
    throw new ValidationError("The FX rate must be positive", {
      rate: scaledRate.toString(),
    });
  }
  // `RATE_SCALE` divides out here as it does in `convert`; the ceiling applies
  // to the whole divisor, not to the asset scale alone, or the rate's fraction
  // would be rounded up a second time.
  const divisor = 10n ** BigInt(assetDecimals(value.asset)) * RATE_SCALE;
  const numerator = value.amount * scaledRate;
  return money((numerator + divisor - 1n) / divisor, target);
}
