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
  ETH: { kind: "crypto", decimals: 18, name: "Ether" },
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
