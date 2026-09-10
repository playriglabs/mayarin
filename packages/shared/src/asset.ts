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
  /**
   * Surplus below which returning the money costs more than the money (#211).
   *
   * A cross-asset x402 payment authorises a fixed amount grossed up by
   * slippage, so the payer is nearly always owed change. Returning it is an
   * ERC-20 transfer the operator pays gas for, plus a liability row that has to
   * be reconciled for as long as it sits there. Under some amount both of those
   * cost more than the change is worth.
   *
   * Absent means **no amount is dust**: everything is owed back. That is the
   * right default for an asset that cannot reach this path — nothing here may
   * decide to keep a payer's money on a guess — so a threshold is declared only
   * for the assets an `exact` authorization can actually be signed in, which is
   * the EIP-3009 stablecoins.
   */
  readonly dustThreshold?: bigint;
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
  // Southeast Asian fiat
  IDR: {
    kind: "fiat",
    decimals: 2,
    iso4217Numeric: "360",
    symbol: "Rp",
    name: "Indonesian Rupiah",
  },
  SGD: { kind: "fiat", decimals: 2, iso4217Numeric: "702", symbol: "S$", name: "Singapore Dollar" },
  MYR: {
    kind: "fiat",
    decimals: 2,
    iso4217Numeric: "458",
    symbol: "RM",
    name: "Malaysian Ringgit",
  },
  THB: { kind: "fiat", decimals: 2, iso4217Numeric: "764", symbol: "฿", name: "Thai Baht" },
  PHP: { kind: "fiat", decimals: 2, iso4217Numeric: "608", symbol: "₱", name: "Philippine Peso" },
  VND: { kind: "fiat", decimals: 0, iso4217Numeric: "704", symbol: "₫", name: "Vietnamese Dong" },
  BND: { kind: "fiat", decimals: 2, iso4217Numeric: "096", symbol: "B$", name: "Brunei Dollar" },
  MMK: { kind: "fiat", decimals: 2, iso4217Numeric: "104", symbol: "K", name: "Myanmar Kyat" },
  KHR: { kind: "fiat", decimals: 2, iso4217Numeric: "116", symbol: "៛", name: "Cambodian Riel" },
  LAK: { kind: "fiat", decimals: 2, iso4217Numeric: "418", symbol: "₭", name: "Lao Kip" },

  // Global and East Asian fiat
  USD: {
    kind: "fiat",
    decimals: 2,
    iso4217Numeric: "840",
    symbol: "$",
    name: "United States Dollar",
  },
  JPY: { kind: "fiat", decimals: 0, iso4217Numeric: "392", symbol: "¥", name: "Japanese Yen" },
  CNY: { kind: "fiat", decimals: 2, iso4217Numeric: "156", symbol: "CN¥", name: "Chinese Yuan" },
  HKD: {
    kind: "fiat",
    decimals: 2,
    iso4217Numeric: "344",
    symbol: "HK$",
    name: "Hong Kong Dollar",
  },
  EUR: { kind: "fiat", decimals: 2, iso4217Numeric: "978", symbol: "€", name: "Euro" },
  GBP: { kind: "fiat", decimals: 2, iso4217Numeric: "826", symbol: "£", name: "Pound Sterling" },
  AUD: {
    kind: "fiat",
    decimals: 2,
    iso4217Numeric: "036",
    symbol: "A$",
    name: "Australian Dollar",
  },
  CAD: { kind: "fiat", decimals: 2, iso4217Numeric: "124", symbol: "C$", name: "Canadian Dollar" },

  // Middle Eastern fiat
  AED: {
    kind: "fiat",
    decimals: 2,
    iso4217Numeric: "784",
    symbol: "د.إ",
    name: "UAE Dirham",
  },
  SAR: { kind: "fiat", decimals: 2, iso4217Numeric: "682", symbol: "ر.س", name: "Saudi Riyal" },

  // Latin American fiat
  BRL: { kind: "fiat", decimals: 2, iso4217Numeric: "986", symbol: "R$", name: "Brazilian Real" },
  MXN: { kind: "fiat", decimals: 2, iso4217Numeric: "484", symbol: "MX$", name: "Mexican Peso" },

  // Settlement assets
  // One cent of change, which is below the smallest unit any of this is
  // accounted in and well under the transfer that would carry it back.
  USDC: { kind: "stablecoin", decimals: 6, dustThreshold: 10_000n, name: "USD Coin" },
  USDT: { kind: "stablecoin", decimals: 6, dustThreshold: 10_000n, name: "Tether USD" },
  /**
   * Euro-denominated, which makes it the one stablecoin here that is NOT a
   * dollar in another representation. `EURC/USDC` is a real exchange rate — the
   * EUR/USD one — so it must never be declared in `QUOTE_PEGGED_PAIRS`: a
   * pegged pair reads no price at all and would settle euros as dollars, an
   * error of whatever the pair happens to be worth that day.
   */
  EURC: { kind: "stablecoin", decimals: 6, dustThreshold: 10_000n, name: "Euro Coin" },
  PYUSD: { kind: "stablecoin", decimals: 6, name: "PayPal USD" },

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

/**
 * Token artwork from Trust Wallet's public asset registry.
 *
 * The components accept strings from API responses. Fiat values deliberately
 * have no remote logo and render as a compact monogram in the UI.
 *
 * USDT is the one Trust Wallet logo that ships without an alpha channel — a flat
 * white square — so it is overridden with a self-hosted transparent mark. The
 * argument lets each frontend hand Vite or Astro the public URL it serves, the
 * same way `chainLogoUrl` handles the local Arc logo.
 */
const TRUST_WALLET_ASSET_LOGOS: Readonly<Record<string, string>> = {
  BTC: "https://assets-cdn.trustwallet.com/blockchains/bitcoin/info/logo.png",
  ETH: "https://assets-cdn.trustwallet.com/blockchains/ethereum/info/logo.png",
  EURC: "https://assets-cdn.trustwallet.com/blockchains/ethereum/assets/0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c/logo.png",
  PYUSD:
    "https://assets-cdn.trustwallet.com/blockchains/ethereum/assets/0x6c3ea9036406852006290770BEdFcAbA0e23A0e8/logo.png",
  USDC: "https://assets-cdn.trustwallet.com/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png",
};

/**
 * The canonical token logo, or undefined when a value is not an on-chain token.
 *
 * USDT resolves to `usdtLogo` (default `/tokens/usdt.svg`) rather than the
 * white-background Trust Wallet PNG.
 */
export function assetLogoUrl(symbol: string, usdtLogo = "/tokens/usdt.svg"): string | undefined {
  if (symbol.toUpperCase() === "USDT") return usdtLogo;
  return TRUST_WALLET_ASSET_LOGOS[symbol.toUpperCase()];
}

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
 * Whether an amount of this asset is too small to be worth moving (#211).
 *
 * `0n` is dust in the arithmetic sense but never reaches here: a zero surplus
 * is no movement at all and the caller skips the posting entirely.
 *
 * An asset with no declared threshold answers `false` for every amount — see
 * `dustThreshold`. Keeping somebody's money is a decision, and an asset that
 * has not made it does not get to.
 */
export function isDustAmount(code: AssetCode, minorUnits: bigint): boolean {
  const threshold = REGISTRY[code].dustThreshold;
  return threshold !== undefined && minorUnits <= threshold;
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
