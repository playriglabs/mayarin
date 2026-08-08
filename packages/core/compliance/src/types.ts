/**
 * Audit trail types (RFC #16).
 *
 * Compliance here is a *read* concern. Nothing in this package writes: the
 * record it produces is assembled from sources that are already append-only —
 * clearing events, ledger postings, and confirmed chain logs. That is the point
 * of the RFC's framing that the architecture makes compliance cheap rather than
 * absent. There is no compliance table to keep in sync, and no second copy of
 * the truth to disagree with the first.
 */

import type { Deposit, SettlementEvent } from "@mayarin/chain";
import type { ClearingEvent, ClearingTransaction } from "@mayarin/clearing";
import type { LedgerTransaction } from "@mayarin/ledger";
import type { PaymentIntent } from "@mayarin/payment-intent";
import type { AssetCode, Money } from "@mayarin/shared";

/**
 * Scope of an audit query: one merchant, optionally bounded by time and asset.
 *
 * `merchantId` is required and has no "all merchants" value. A compliance query
 * that can silently span tenants is the wrong default for a surface whose whole
 * job is producing a defensible record, and the dashboard's own visibility split
 * is already per merchant.
 *
 * `asset` filters on the **settlement** asset — what the merchant was actually
 * paid in. The payer's asset is a property of one leg and is carried in the
 * record itself; it is deliberately not a filter here, because "payments in
 * USDC" meaning two different things depending on the leg is how a compliance
 * answer becomes unreliable.
 */
export interface AuditFilter {
  readonly merchantId: string;
  /** Inclusive lower bound on the clearing transaction's creation time. */
  readonly from?: Date;
  /** Exclusive upper bound, so adjacent windows neither overlap nor gap. */
  readonly to?: Date;
  readonly asset?: AssetCode;
  readonly limit?: number;
}

/** One row of an audit listing: enough to decide what to open, not the record itself. */
export interface PaymentAuditSummary {
  readonly clearingTransactionId: string;
  readonly paymentIntentId: string;
  readonly merchantId: string;
  readonly state: ClearingTransaction["state"];
  /** What the merchant quoted, in their pricing currency. */
  readonly sourceAmount: Money;
  readonly settlementAsset: AssetCode;
  /** Absent before `PRICE_LOCKED` — there is nothing priced yet. */
  readonly settlementAmount?: Money;
  readonly fee?: Money;
  readonly netAmount?: Money;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Everything recorded about one payment, from every source that recorded it.
 *
 * The four sources answer four different questions, which is why the record
 * carries all of them rather than a flattened summary:
 *
 * - `intent` and `transaction` — what was owed, and where paying it ended up.
 * - `history` — how it got there, transition by transition.
 * - `postings` — what value moved, in balanced double entry.
 * - `deposits` and `settlement` — what the chain independently witnessed.
 */
export interface PaymentAuditRecord {
  readonly transaction: ClearingTransaction;
  /** Absent only if the intent row was removed, which nothing does today. */
  readonly intent?: PaymentIntent;
  readonly history: readonly ClearingEvent[];
  readonly postings: readonly LedgerTransaction[];
  /** Confirmed and unconfirmed transfers seen at this payment's deposit address. */
  readonly deposits: readonly Deposit[];
  /** The `PaymentCompleted` log, on the contract path once the indexer has seen it. */
  readonly settlement?: SettlementEvent;
  readonly reconciliation: ReconciliationVerdict;
}

/** One ledger figure that disagrees with the chain. */
export interface ReconciliationDifference {
  /** What was compared, e.g. `"net"` or `"fee"`. */
  readonly field: string;
  readonly ledger: Money;
  readonly onChain: Money;
}

/**
 * Whether the ledger and the chain tell the same story.
 *
 * A tagged union rather than a boolean plus notes: "we did not check" and "we
 * checked and they agree" are different answers to a compliance question, and
 * collapsing them into `true` is how an unchecked payment reads as a verified
 * one.
 */
export type ReconciliationVerdict =
  | { readonly status: "MATCHED"; readonly net: Money; readonly fee: Money }
  | { readonly status: "MISMATCHED"; readonly differences: readonly ReconciliationDifference[] }
  /** No confirmed `PaymentCompleted` log — the deposit path, or not yet indexed. */
  | { readonly status: "NO_ON_CHAIN_RECORD" };
