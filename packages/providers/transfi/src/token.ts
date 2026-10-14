/**
 * Mayarin chain + asset to TransFi's token code.
 *
 * TransFi folds the network into the currency code (`USDCARB`), with no
 * separate network field, so the code is looked up rather than built. A pair
 * absent from the table cannot be funded through TransFi, and that is a
 * `undefined` the caller handles — never a guessed code.
 */

const TOKEN_CODES: Readonly<Record<string, string>> = {
  "arbitrum:USDC": "USDCARB",
  "arbitrum:USDT": "USDTARB",
  "base:USDC": "USDCBASE",
  "ethereum:USDC": "USDC",
  "ethereum:USDT": "USDT",
  "polygon:USDC": "USDCPOLYGON",
  "polygon:USDT": "USDTPOLYGON",
};

/**
 * Testnet chains, mapped to the mainnet token of the same network.
 *
 * Only ever consulted against TransFi's sandbox, where no value moves: the order
 * names a testnet address and nothing is delivered, which is what lets the whole
 * flow be exercised on a testnet deployment. Against production the same
 * mapping would send real mainnet tokens to an address on a chain nobody
 * watches, so it must never apply there.
 */
const SANDBOX_TOKEN_CODES: Readonly<Record<string, string>> = {
  "arbitrum-sepolia:USDC": "USDCARB",
  "base-sepolia:USDC": "USDCBASE",
  "ethereum-sepolia:USDC": "USDC",
  // Solana is deliberately absent. TransFi lists USDC and USDT there, but a
  // Solana deposit is settled by an on-chain treasury payment that pulls from the
  // deposit address's token account — which the sandbox, moving no value, never
  // creates. The payment would be recorded as received and then fail at
  // settlement after three attempts. Offering it would be offering a flow that
  // cannot finish; it belongs here when there is a way to fund the address.
};

export interface TokenOptions {
  /** The client is pointed at TransFi's sandbox, not production. */
  readonly sandbox: boolean;
}

function table(options: TokenOptions): Readonly<Record<string, string>> {
  return options.sandbox ? { ...TOKEN_CODES, ...SANDBOX_TOKEN_CODES } : TOKEN_CODES;
}

export function transfiTokenCode(
  chain: string,
  asset: string,
  options: TokenOptions = { sandbox: false },
): string | undefined {
  return table(options)[`${chain}:${asset}`];
}

/** The chain and asset pairs a payment can be funded on, in the given mode. */
export function transfiSupportedPairs(
  options: TokenOptions = { sandbox: false },
): readonly { readonly chain: string; readonly asset: string }[] {
  return Object.keys(table(options)).map((key) => {
    const [chain = "", asset = ""] = key.split(":");
    return { chain, asset };
  });
}
