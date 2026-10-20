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
  // Circle's and Tether's own tokens, and EURC, all 6 decimals: the domain's unit, so no
  // conversion applies (token-units).
  ethereum: {
    USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    EURC: "0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c",
  },
  base: {
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    EURC: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42",
    // Tether USD as bridged to Base (name "Tether USD", 6 decimals, read back on chain).
    USDT: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
    // Payer-only, never settled in. WETH is the OP-stack predeploy (18 decimals); cbBTC is
    // Coinbase's wrapped bitcoin (8 decimals). Both read back on chain.
    WETH: "0x4200000000000000000000000000000000000006",
    CBBTC: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
  },
  arbitrum: {
    USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
  },
  // Circle's native USDC, 6 decimals. Polygon's USDT address now answers as USDT0
  // (`symbol()` is "USDT0"), a LayerZero OFT that is Tether's own token: admitted by
  // decision of 20 October 2026, accepting that it is upgradeable and can be frozen.
  polygon: {
    USDC: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    USDT: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    // Payer-only, never settled in: the bridged WETH (18 decimals) and WBTC (8), read back.
    WETH: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
    WBTC: "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6",
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
