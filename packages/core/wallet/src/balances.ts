/**
 * Reading what a merchant's payout address actually holds (#11).
 *
 * The settlement address is where value lands; a merchant asking "how much do I
 * have" is asking the chain, not this database. Nothing here is derived from
 * the ledger: the ledger records what Mayarin owes and what it moved, and after
 * an on-chain settlement the money is not Mayarin's to account for any more.
 *
 * A port rather than a viem call in a service because `core` holds no
 * transport — and because the read has to answer for both a native balance and
 * an ERC-20 one, which are two different chain calls hidden behind one
 * question.
 */

import type { ChainId } from "@mayarin/chain";
import type { AssetCode, Money } from "@mayarin/shared";

export interface WalletBalanceQuery {
  readonly chain: ChainId;
  /** Lowercase `0x`-prefixed. */
  readonly address: string;
  /** Which assets to read. An asset the deployment cannot resolve is skipped, not guessed. */
  readonly assets: readonly AssetCode[];
}

export interface WalletBalanceReader {
  /**
   * Balances for the assets asked about, in the order they were asked for.
   *
   * Assets the reader has no contract address for are omitted rather than
   * returned as zero: "nothing configured" and "an empty wallet" are different
   * answers, and a merchant reading a zero would take the wrong action.
   */
  balances(query: WalletBalanceQuery): Promise<readonly Money[]>;
}
