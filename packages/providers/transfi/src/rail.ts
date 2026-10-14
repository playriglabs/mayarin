/**
 * Which of a payment's rails a local-currency payment is delivered on.
 *
 * Nobody chooses it at the till: a payer paying a rupiah QR has no opinion about
 * networks, and a merchant has not been asked per payment. So it is a rule, and
 * the rule is written down here rather than being whichever rail happened to be
 * listed first.
 *
 * In order of precedence:
 *
 * 1. the chain the merchant named, if the provider can deliver there — the
 *    merchant's decision outranks any default;
 * 2. a rail whose asset *is* the merchant's settlement asset. The other kind
 *    needs a conversion on arrival, which is on-chain work from a deposit
 *    address, and a payer who paid in rupiah must not be the one who finds out
 *    that step can fail;
 * 3. the cheaper chain, from `CHAIN_COST_ORDER`;
 * 4. the order the rails were given in.
 *
 * A rail the provider cannot deliver to is never a candidate, whatever else
 * recommends it.
 */

import { transfiTokenCode } from "./token.ts";

export interface CandidateRail {
  readonly chain: string;
  readonly asset: string;
  /** What the merchant is paid in on this chain. */
  readonly settlementAsset: string;
}

/**
 * Cheapest to move on first. A chain the provider supports and this list does
 * not name sorts after all of them, in the order it was given.
 */
export const CHAIN_COST_ORDER: readonly string[] = [
  "base",
  "base-sepolia",
  "arbitrum",
  "arbitrum-sepolia",
  "polygon",
  "solana",
  "solana-devnet",
  "ethereum",
  "ethereum-sepolia",
];

export function chooseLocalCurrencyRail<T extends CandidateRail>(
  rails: readonly T[],
  options: { readonly sandbox: boolean; readonly preferredChain?: string | undefined },
): T | undefined {
  const rank = (chain: string): number => {
    const index = CHAIN_COST_ORDER.indexOf(chain);
    return index === -1 ? CHAIN_COST_ORDER.length : index;
  };

  const candidates = rails
    .map((rail, position) => ({ rail, position }))
    .filter(
      ({ rail }) =>
        transfiTokenCode(rail.chain, rail.asset, { sandbox: options.sandbox }) !== undefined,
    );

  candidates.sort((a, b) => {
    const preferred =
      Number(b.rail.chain === options.preferredChain) -
      Number(a.rail.chain === options.preferredChain);
    if (preferred !== 0) return preferred;

    const conversion =
      Number(a.rail.asset !== a.rail.settlementAsset) -
      Number(b.rail.asset !== b.rail.settlementAsset);
    if (conversion !== 0) return conversion;

    const cost = rank(a.rail.chain) - rank(b.rail.chain);
    if (cost !== 0) return cost;

    return a.position - b.position;
  });

  return candidates[0]?.rail;
}
