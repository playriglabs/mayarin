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
    // Sky's DAI and USDS carry 18 decimals beside the 6-decimal stablecoins above:
    // `token-units` scales them per token.
    DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    USDS: "0xdC035D45d973E3EC169d2276DDab16f1e407384F",
    // Payer-only, never settled in: wrapped ether and bitcoin, and the governance and
    // utility tokens people hold. Each was read back (name, symbol, decimals) and is in
    // Uniswap's token list at that address.
    WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    WBTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    LINK: "0x514910771AF9Ca656af840dff83E8264EcF986CA",
    UNI: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
    AAVE: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9",
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
    // `symbol()` answers "USDT0": Tether's LayerZero OFT at the address Arbitrum's USDT
    // lived at, admitted on the same terms as Polygon's.
    USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    DAI: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
    USDS: "0x6491c05A82219b8D1479057361ff1654749b876b",
    // Paxos's Global Dollar, 6 decimals.
    USDG: "0x004B506865409877C9fa29BFB1eba929984B9BBC",
    // Payer-only, never settled in.
    WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    WBTC: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
    ARB: "0x912CE59144191C1204E64559FE8253a0e49E6548",
    LINK: "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4",
    UNI: "0xFa7F8980b0f1E64A2062791cc3b0871572f1F7f0",
    AAVE: "0xba5DdD1f9d7F570dc94a51479a000E3BCE967196",
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
    // Binance-Peg DAI, and FDUSD (First Digital's own token), both 18 decimals like the rest.
    DAI: "0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3",
    FDUSD: "0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409",
    // Payer-only, never settled in. BNB itself is the native coin and has no address.
    WBNB: "0xbb4CdB9CBd36B01bD1cBaEBF2de08d9173bc095c",
    BTCB: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
    LINK: "0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD",
    UNI: "0xBf5140A22578168FD562DCcF235E5D43A02ce9B1",
    CAKE: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
  },
};

/** True for any token on a non-mainnet chain; on a mainnet chain, only a listed one. */
export function isReviewedToken(chain: ChainId, asset: AssetCode, address: string): boolean {
  if (!isMainnetChain(chain)) return true;
  return REVIEWED_MAINNET_TOKENS[chain]?.[asset]?.toLowerCase() === address.toLowerCase();
}
