/**
 * Does the ledger agree with the chain?
 *
 * This is the criterion "ledger + on-chain events reconstruct any payment"
 * doing actual work. Assembling both into one object proves nothing on its own —
 * two records can sit side by side and contradict each other. The check is what
 * turns the record into evidence.
 *
 * Both sides are read at their settlement figures, because that is the only
 * quantity the two sources independently state:
 *
 * ```
 * ledger    credits to MERCHANT_PAYABLE   =  net   =  what the merchant is owed
 *           credits to FEE_REVENUE        =  fee   =  Mayarin's take
 *
 * chain     PaymentCompleted.settledAmount        =  what merchantSafe received
 *           PaymentCompleted.fee                  =  what the treasury received
 * ```
 *
 * A pure function over an already-assembled record: no I/O, no clock, so it is
 * as testable as the arithmetic it checks.
 */

import type { SettlementEvent } from "@mayarin/chain";
import { type LedgerTransaction, parseAccountCode } from "@mayarin/ledger";
import { type AssetCode, type Money, money, sum } from "@mayarin/shared";
import type { ReconciliationDifference, ReconciliationVerdict } from "./types.ts";

export interface ReconcileInput {
  readonly settlementAsset: AssetCode;
  readonly postings: readonly LedgerTransaction[];
  readonly settlement?: SettlementEvent;
}

export function reconcile(input: ReconcileInput): ReconciliationVerdict {
  const { settlement, settlementAsset, postings } = input;

  // Below the confirmation depth a settlement has told the engine nothing and
  // can still vanish, so it is not something to reconcile against — the same
  // finality line the indexer draws before completing a payment.
  if (settlement === undefined || settlement.status !== "CONFIRMED") {
    return { status: "NO_ON_CHAIN_RECORD" };
  }

  const ledgerNet = creditedTo(postings, "MERCHANT_PAYABLE", settlementAsset);
  const ledgerFee = creditedTo(postings, "FEE_REVENUE", settlementAsset);
  const onChainNet = money(settlement.settledAmount, settlementAsset);
  const onChainFee = money(settlement.fee, settlementAsset);

  const differences: ReconciliationDifference[] = [
    { field: "net", ledger: ledgerNet, onChain: onChainNet },
    { field: "fee", ledger: ledgerFee, onChain: onChainFee },
  ].filter((candidate) => candidate.ledger.amount !== candidate.onChain.amount);

  if (differences.length > 0) return { status: "MISMATCHED", differences };

  return { status: "MATCHED", net: ledgerNet, fee: ledgerFee };
}

/**
 * Total credited to one account kind in one asset.
 *
 * Credits only, deliberately. `MERCHANT_PAYABLE` is credited when the merchant's
 * claim arises and debited again when it is handed to a rail, so a net balance
 * would read zero for a fully settled payment — which is correct bookkeeping and
 * the wrong number for this question. What the chain paid is comparable to what
 * the claim *was*, not to what remains of it.
 */
function creditedTo(
  postings: readonly LedgerTransaction[],
  kind: "MERCHANT_PAYABLE" | "FEE_REVENUE",
  asset: AssetCode,
): Money {
  const amounts = postings
    .flatMap((posting) => posting.entries)
    .filter((entry) => entry.direction === "CREDIT" && entry.amount.asset === asset)
    .filter((entry) => parseAccountCode(entry.accountCode).kind === kind)
    .map((entry) => entry.amount);

  return sum(amounts, asset);
}
