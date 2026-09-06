import { CHAIN_IDS, type ChainId } from "@mayarin/chain";
import { VIEM_CHAINS } from "@mayarin/provider-viem-chains";
import { type AssetCode, assetDecimals, ConfigurationError } from "@mayarin/shared";

/** Native payment amounts must already use the domain asset's minor units.
 * Arc USDC is deliberately read and transferred through its ERC-20 interface.
 * Merely converting a balance would leave native deposits and router inputs
 * using a different scale, and could count the same holding twice.
 */
export function validateNativeAssets(assets: Readonly<Partial<Record<ChainId, AssetCode>>>): void {
  for (const chain of CHAIN_IDS) {
    const asset = assets[chain];
    if (asset === undefined) continue;
    const native = VIEM_CHAINS[chain].nativeCurrency;
    if (native.symbol !== asset || native.decimals !== assetDecimals(asset)) {
      throw new ConfigurationError(
        `Native ${asset} on ${chain} does not match the domain asset; use its ERC-20 interface when available`,
        { chain, asset, nativeSymbol: native.symbol, nativeDecimals: native.decimals },
      );
    }
  }
}
