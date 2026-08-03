/**
 * Ledger postings for the clearing steps that move value.
 *
 * Three postings describe a payment end to end:
 *
 * ```
 * ASSET_RECEIVED   Dr TREASURY               (settlement amount)
 *                  Cr MERCHANT_PAYABLE       (net)
 *                  Cr FEE_REVENUE            (fee)
 *
 * CLEARING         Dr MERCHANT_PAYABLE       (net)
 *                  Cr SETTLEMENT_IN_FLIGHT   (net)
 *
 * SETTLED          Dr SETTLEMENT_IN_FLIGHT   (net)
 *                  Cr TREASURY               (net)
 * ```
 *
 * Net effect: treasury keeps the fee, the merchant's claim is extinguished only
 * once the rail confirms delivery, and value in flight is visible at all times.
 *
 * Each posting's idempotency key is derived from the transaction and the state
 * it records, so replaying a step cannot double-post.
 */

import { credit, type DraftTransaction, debit } from "@mayarin/ledger";
import { LedgerImbalanceError, type Money } from "@mayarin/shared";
import type { ClearingState, ClearingTransaction } from "./types.ts";

export function postingIdempotencyKey(
  transaction: ClearingTransaction,
  state: ClearingState,
): string {
  return `${transaction.id}:${state}`;
}

export function assetReceivedPosting(transaction: ClearingTransaction): DraftTransaction {
  const { settlementAmount, fee, netAmount } = requirePricedAmounts(transaction);

  return {
    description: `Asset received for payment ${transaction.paymentIntentId}`,
    reference: transaction.id,
    idempotencyKey: postingIdempotencyKey(transaction, "ASSET_RECEIVED"),
    entries: [
      debit("TREASURY", settlementAmount),
      credit("MERCHANT_PAYABLE", netAmount),
      credit("FEE_REVENUE", fee),
    ],
  };
}

export function clearingPosting(transaction: ClearingTransaction): DraftTransaction {
  const { netAmount } = requirePricedAmounts(transaction);

  return {
    description: `Cleared payment ${transaction.paymentIntentId} for settlement`,
    reference: transaction.id,
    idempotencyKey: postingIdempotencyKey(transaction, "CLEARING"),
    entries: [debit("MERCHANT_PAYABLE", netAmount), credit("SETTLEMENT_IN_FLIGHT", netAmount)],
  };
}

export function settledPosting(transaction: ClearingTransaction): DraftTransaction {
  const { netAmount } = requirePricedAmounts(transaction);

  return {
    description: `Settled payment ${transaction.paymentIntentId} via ${transaction.provider}`,
    reference: transaction.id,
    idempotencyKey: postingIdempotencyKey(transaction, "SETTLED"),
    entries: [debit("SETTLEMENT_IN_FLIGHT", netAmount), credit("TREASURY", netAmount)],
  };
}

/**
 * Settled posting for an _internal_ settlement (a stablecoin credit the merchant
 * holds with Mayarin). The in-flight value moves to a merchant holding
 * liability — withdrawable on-chain in Phase 4 — instead of back to treasury.
 * Shares the `SETTLED` idempotency key with `settledPosting`: exactly one of the
 * two ever runs per transaction, so a resume replays the same posting as a no-op.
 */
export function internalSettledPosting(transaction: ClearingTransaction): DraftTransaction {
  const { netAmount } = requirePricedAmounts(transaction);

  return {
    description: `Settled payment ${transaction.paymentIntentId} via ${transaction.provider} (internal)`,
    reference: transaction.id,
    idempotencyKey: postingIdempotencyKey(transaction, "SETTLED"),
    entries: [debit("SETTLEMENT_IN_FLIGHT", netAmount), credit("MERCHANT_HOLDING", netAmount)],
  };
}

interface PricedAmounts {
  readonly settlementAmount: Money;
  readonly fee: Money;
  readonly netAmount: Money;
}

/**
 * A posting can only be built once the price is locked. Reaching here without
 * amounts means the state machine let a step run out of order.
 */
function requirePricedAmounts(transaction: ClearingTransaction): PricedAmounts {
  const { settlementAmount, fee, netAmount } = transaction;

  if (settlementAmount === undefined || fee === undefined || netAmount === undefined) {
    throw new LedgerImbalanceError(
      `Clearing transaction ${transaction.id} has no locked amounts to post`,
      { id: transaction.id, state: transaction.state },
    );
  }

  if (settlementAmount.amount !== fee.amount + netAmount.amount) {
    throw new LedgerImbalanceError(
      `Clearing transaction ${transaction.id} fee and net do not sum to the settlement amount`,
      {
        id: transaction.id,
        settlementAmount: settlementAmount.amount.toString(),
        fee: fee.amount.toString(),
        netAmount: netAmount.amount.toString(),
      },
    );
  }

  return { settlementAmount, fee, netAmount };
}
