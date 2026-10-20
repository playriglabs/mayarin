/**
 * The tokens a mainnet deployment may hold or settle in (SEC-18).
 *
 * Settlement assumes a standard ERC-20: what was sent is what arrives. A
 * fee-on-transfer, rebasing or malicious token breaks that for the merchant, so
 * a token reaches a mainnet chain only by being written here, which is a code
 * review. Testnets are not checked.
 *
 * Every entry was read back from its chain (`symbol()`, `decimals()`, code
 * present) when it was added. Circle's and Tether's tokens are upgradeable and
 * can blacklist or pause: reviewing them is accepting that, and watching their
 * proxy admins is a separate control this list does not provide.
 */

import type { AssetCode } from "@mayarin/shared";
import { type ChainId, isMainnetChain } from "./types.ts";

export const REVIEWED_MAINNET_TOKENS: Readonly<
  Partial<Record<ChainId, Readonly<Partial<Record<AssetCode, string>>>>>
> = {
  base: {
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    EURC: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42",
  },
  arbitrum: {
    USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
  },
  // Circle's native USDC, 6 decimals. Polygon's USDT address now answers as USDT0,
  // a LayerZero OFT: not admitted until that is reviewed as a token of its own.
  polygon: {
    USDC: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  },
  // Binance-Peg tokens, not Circle's or Tether's own issuance, and 18 decimals:
  // `token-units` counts them in the domain's 6.
  bsc: {
    USDC: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    USDT: "0x55d398326f99059fF775485246999027B3197955",
  },
};

/** True for any token on a non-mainnet chain; on a mainnet chain, only a listed one. */
export function isReviewedToken(chain: ChainId, asset: AssetCode, address: string): boolean {
  if (!isMainnetChain(chain)) return true;
  return REVIEWED_MAINNET_TOKENS[chain]?.[asset]?.toLowerCase() === address.toLowerCase();
}
