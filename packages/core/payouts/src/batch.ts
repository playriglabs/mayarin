/**
 * What a batch adds up to, and whether the chain agrees it happened.
 */

import { type AssetCode, type Money, money } from "@mayarin/shared";
import type { ObservedTransfer, PayoutRow } from "./types.ts";

/** One total per asset, in the order each asset first appears. */
export function payoutTotals(rows: readonly PayoutRow[]): readonly Money[] {
  const totals = new Map<AssetCode, bigint>();
  for (const { amount } of rows) {
    totals.set(amount.asset, (totals.get(amount.asset) ?? 0n) + amount.amount);
  }
  return [...totals].map(([asset, amount]) => money(amount, asset));
}

/**
 * The rows the chain has no transfer for.
 *
 * Each row must be matched by its own `Transfer` out of the source — the Safe
 * or the paying wallet — same
 * recipient, same asset, same amount — and each transfer may match one row
 * only, so two identical rows need two identical transfers. An empty result is
 * the only one that records a batch: a transaction that paid some rows and
 * not others (a Safe's inner call can fail while the outer transaction
 * succeeds) is not the batch the merchant asked for.
 */
export function unmatchedRows(
  rows: readonly PayoutRow[],
  transfers: readonly ObservedTransfer[],
  sourceAddress: string,
): readonly PayoutRow[] {
  const source = sourceAddress.toLowerCase();
  const pool = transfers.filter((transfer) => transfer.from.toLowerCase() === source);
  const used = new Set<number>();

  return rows.filter((row) => {
    const index = pool.findIndex(
      (transfer, i) =>
        !used.has(i) &&
        transfer.to.toLowerCase() === row.to &&
        transfer.amount.asset === row.amount.asset &&
        transfer.amount.amount === row.amount.amount,
    );
    if (index === -1) return true;
    used.add(index);
    return false;
  });
}
