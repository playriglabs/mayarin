/**
 * The wallet form of a crypto amount.
 *
 * `formatted` on the wire is the machine decimal: dot-separated, ungrouped,
 * at the asset's full precision — `3.500000` for 3.5 USDC. A wallet field
 * wants that value without the trailing-zero noise: `3.5`. Trimming removes
 * zeros and nothing else, so the string stays exact and stays valid wallet
 * input. The localized `display` form never appears near a wallet: its comma
 * decimal is not a value a wallet accepts.
 */
export function walletAmount(formatted: string): string {
  if (!formatted.includes(".")) return formatted;
  return formatted.replace(/0+$/, "").replace(/\.$/, "");
}
