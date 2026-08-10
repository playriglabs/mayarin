/**
 * Asset registry.
 *
 * Mayarin normalizes every unit of value — fiat, stablecoin or native crypto —
 * behind a single `AssetCode`. The registry is the only place that knows how
 * many minor units make up one whole unit of an asset, so nothing downstream
 * has to hard-code decimal handling.
 */

export type AssetKind = "fiat" | "stablecoin" | "crypto";

export interface AssetDefinition {
  readonly code: AssetCode;
  readonly kind: AssetKind;
  /** Number of minor units per whole unit, as a power of ten. */
  readonly decimals: number;
  /**
   * How many decimals a **payer** is ever asked for.
   *
   * Distinct from `decimals`, which is the asset's own precision. ETH carries
   * 18, and an amount written out to all of them is one no human types and one
   * a good many wallets refuse: their manual-entry fields cap out at eight. An
   * amount a payer cannot enter is an amount they underpay, and an underpaid
   * deposit never funds — the watcher wants the full sum.
   *
   * So an amount asked of a payer is rounded UP to this precision before it is
   * ever shown, and the same rounded figure goes into the QR. One number, in
   * the code and on the screen and in the field they type it into.
   *
   * Absent means the asset's own precision is already payable: two decimals of
   * rupiah or six of USDC are fine as they are.
   */
  readonly payerDecimals?: number;
  /** ISO 4217 numeric code. Only defined for fiat assets. */
  readonly iso4217Numeric?: string;
  /**
   * Currency symbol written before the digits. Only defined where one is
   * conventional — a stablecoin is rendered with its code instead.
   */
  readonly symbol?: string;
  readonly name: string;
}

const DEFINITIONS = {
  // Fiat
  IDR: {
    kind: "fiat",
    decimals: 2,
    iso4217Numeric: "360",
    symbol: "Rp",
    name: "Indonesian Rupiah",
  },
  USD: {
    kind: "fiat",
    decimals: 2,
    iso4217Numeric: "840",
    symbol: "$",
    name: "United States Dollar",
  },
  SGD: { kind: "fiat", decimals: 2, iso4217Numeric: "702", symbol: "S$", name: "Singapore Dollar" },
  THB: { kind: "fiat", decimals: 2, iso4217Numeric: "764", symbol: "฿", name: "Thai Baht" },
  MYR: {
    kind: "fiat",
    decimals: 2,
    iso4217Numeric: "458",
    symbol: "RM",
    name: "Malaysian Ringgit",
  },

  // Settlement assets
  IDRX: { kind: "stablecoin", decimals: 2, name: "IDRX" },
  USDC: { kind: "stablecoin", decimals: 6, name: "USD Coin" },
  USDT: { kind: "stablecoin", decimals: 6, name: "Tether USD" },

  // Native crypto
  ETH: {
    kind: "crypto",
    decimals: 18,
    // Eight, which is what wallet entry fields and every exchange UI settle on.
    // The dust given up by rounding up to it is ~1e-8 ETH, well under the fee
    // of the transfer that carries it.
    payerDecimals: 8,
    name: "Ether",
  },
  BTC: { kind: "crypto", decimals: 8, name: "Bitcoin" },
} as const satisfies Record<string, Omit<AssetDefinition, "code">>;

export type AssetCode = keyof typeof DEFINITIONS;

export const ASSET_CODES = Object.keys(DEFINITIONS) as readonly AssetCode[];

const REGISTRY: Readonly<Record<AssetCode, AssetDefinition>> = Object.fromEntries(
  Object.entries(DEFINITIONS).map(([code, definition]) => [code, { code, ...definition }]),
) as Record<AssetCode, AssetDefinition>;

export function isAssetCode(value: unknown): value is AssetCode {
  return typeof value === "string" && value in REGISTRY;
}

export function getAsset(code: AssetCode): AssetDefinition {
  return REGISTRY[code];
}

export function assetDecimals(code: AssetCode): number {
  return REGISTRY[code].decimals;
}

export function assetSymbol(code: AssetCode): string | undefined {
  return REGISTRY[code].symbol;
}

/**
 * The precision a payer is asked for, which is at most the asset's own.
 *
 * Falls back to `decimals`, so an asset that says nothing is asked for exactly
 * what it can express.
 */
export function assetPayerDecimals(code: AssetCode): number {
  const definition = REGISTRY[code];
  return definition.payerDecimals ?? definition.decimals;
}

/**
 * Resolves the fiat asset a QR payload's ISO 4217 numeric currency code refers
 * to. Returns `undefined` for codes Mayarin does not support yet, so callers can
 * reject the payload rather than guess.
 */
export function assetFromIso4217Numeric(numeric: string): AssetCode | undefined {
  const normalized = numeric.padStart(3, "0");
  for (const definition of Object.values(REGISTRY)) {
    if (definition.iso4217Numeric === normalized) return definition.code;
  }
  return undefined;
}
