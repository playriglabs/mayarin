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
 *
 * ## The deposit path books two steps, not one
 *
 * The sequence above holds when the settlement asset is acquired at the moment
 * the payer's asset is confirmed — true on the contract path, where receive,
 * swap and settle are one atomic transaction.
 *
 * On the deposit path they are seconds apart. The payer's ETH sits at a deposit
 * address until the treasury executor converts it, and posting `TREASURY` at
 * receipt would state a settlement balance that does not exist while the asset
 * actually held is recorded nowhere. So the deposit path splits it:
 *
 * ```
 * ASSET_RECEIVED   Dr PAYER_ASSET_HELD:ETH        (deposit amount)
 *                  Cr PAYER_ASSET_OBLIGATION:ETH  (deposit amount)
 *
 * SWAPPED          Dr PAYER_ASSET_OBLIGATION:ETH  (deposit amount)
 *                  Cr PAYER_ASSET_HELD:ETH        (deposit amount)
 *                  Dr TREASURY:USDC               (swap output)
 *                  Cr MERCHANT_PAYABLE:USDC       (net)
 *                  Cr FEE_REVENUE:USDC            (fee)
 *                  Cr FX_RESULT:USDC              (output − settlement, when the swap beat the lock)
 * ```
 *
 * `CLEARING` and `SETTLED` are unchanged: `MERCHANT_PAYABLE` is credited by the
 * swap instead of by the receipt, one step later, and everything downstream
 * reads the same.
 *
 * ## What "balanced" means across assets
 *
 * The swap posting names two assets, and it needs no new rule — `assertBalanced`
 * already sums debits and credits **per asset** (`totalsByAsset`). So the
 * requirement is not that ETH somehow equals USDC, which no exchange rate could
 * make true at the instant a rate is what is being discovered. It is that each
 * asset balances within itself: the ETH legs cancel exactly, and the USDC legs
 * sum to the swap's actual output.
 *
 * `FX_RESULT` is what makes the USDC side balance when the output differs from
 * the locked settlement amount. A swap that beat the lock credits it (a gain);
 * one that fell short debits it (a loss). Either way the merchant's `net` and
 * the `fee` are exactly what was locked — the difference is Mayarin's, which is
 * the whole point of naming the account.
 */

import { credit, type DraftTransaction, debit } from "@mayarin/ledger";
import { LedgerImbalanceError, type Money } from "@mayarin/shared";
import type { ClearingState, ClearingTransaction } from "./types.ts";

/**
 * Steps that post but are not clearing states.
 *
 * The deposit path's swap happens between `ASSET_RECEIVED` and `CLEARING`
 * without being a state of its own — adding one would change a nine-state
 * machine that every transition, persisted row and doc describes, to record
 * something the executor already knows. The idempotency key still has to
 * distinguish it, so the label widens instead of the state machine.
 */
export type PostingStep = ClearingState | "SWAPPED" | "GAS" | "PAYER_SURPLUS";

export function postingIdempotencyKey(transaction: ClearingTransaction, step: PostingStep): string {
  return `${transaction.id}:${step}`;
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
      ...(fee.amount === 0n ? [] : [credit("FEE_REVENUE", fee)]),
    ],
  };
}

/**
 * What becomes of the payer's change (#211).
 *
 * `refundable` is owed back and sits as a liability until it is returned.
 * `dust` is change the return transaction would cost more than, so it is taken
 * as revenue — stated in an account and an event, never absorbed into a balance
 * nothing explains. `isDustAmount` draws the line and only for the assets that
 * declare one.
 */
export type SurplusDisposition = "refundable" | "dust";

/**
 * The payer's change on a cross-asset x402 payment (#211).
 *
 * `surplus` is what the authorization carried and the swap did not consume,
 * denominated in the payer's asset. Both sides of the entry are the payer's
 * asset and neither touches the settlement asset: the merchant's leg is already
 * accounted for by the receipt, and this is the remainder sitting at the
 * operator afterwards.
 *
 * Posted rather than absorbed. `exact` authorises a fixed amount grossed up by
 * slippage, so a surplus is the normal outcome rather than an anomaly, and an
 * unexplained operator balance is how it would otherwise appear.
 *
 * The credit side is the disposition and nothing else changes: the debit is the
 * operator holding the asset either way, and the two cases differ only in whom
 * it is held for.
 */
export function payerSurplusPosting(
  transaction: ClearingTransaction,
  surplus: Money,
  disposition: SurplusDisposition,
): DraftTransaction {
  return {
    description:
      disposition === "dust"
        ? `Payer surplus below dust on payment ${transaction.paymentIntentId}`
        : `Payer surplus on payment ${transaction.paymentIntentId}`,
    reference: transaction.id,
    idempotencyKey: postingIdempotencyKey(transaction, "PAYER_SURPLUS"),
    entries: [
      debit("PAYER_ASSET_HELD", surplus),
      disposition === "dust" ? credit("FEE_REVENUE", surplus) : credit("PAYER_SURPLUS", surplus),
    ],
  };
}

/**
 * Receipt on the deposit path: the payer's asset arrived, nothing is converted.
 *
 * Denominated entirely in the payer's asset. No settlement-asset account is
 * touched, because no settlement asset has been acquired — that is the whole
 * correction. `swapPosting` books the conversion.
 */
export function depositAssetReceivedPosting(transaction: ClearingTransaction): DraftTransaction {
  const held = requireDepositAmount(transaction);

  return {
    description: `Payer asset received for payment ${transaction.paymentIntentId}`,
    reference: transaction.id,
    idempotencyKey: postingIdempotencyKey(transaction, "ASSET_RECEIVED"),
    entries: [debit("PAYER_ASSET_HELD", held), credit("PAYER_ASSET_OBLIGATION", held)],
  };
}

/**
 * The deposit path's swap: the payer's asset leaves, the settlement asset arrives.
 *
 * `output` is what the swap actually produced, measured on-chain — not what was
 * quoted. The gap between it and the locked `settlementAmount` is the FX result,
 * and it is the reason this posting exists rather than reusing the receipt's.
 *
 * The merchant's `net` and Mayarin's `fee` are always the locked figures. A swap
 * that underperformed does not reduce what the merchant is owed; it books a loss.
 */
export function swapPosting(transaction: ClearingTransaction, output: Money): DraftTransaction {
  const { settlementAmount, fee, netAmount } = requirePricedAmounts(transaction);
  const held = requireDepositAmount(transaction);

  if (output.asset !== settlementAmount.asset) {
    throw new LedgerImbalanceError(
      `Swap output for ${transaction.id} is ${output.asset}, not the settlement asset ${settlementAmount.asset}`,
      { id: transaction.id, output: output.asset, settlement: settlementAmount.asset },
    );
  }

  const difference = output.amount - settlementAmount.amount;
  // A gain credits FX_RESULT, a loss debits it. Either way the settlement-asset
  // legs sum to `output`, which is what the swap actually delivered.
  const fxEntries =
    difference === 0n
      ? []
      : difference > 0n
        ? [credit("FX_RESULT", { amount: difference, asset: output.asset })]
        : [debit("FX_RESULT", { amount: -difference, asset: output.asset })];

  return {
    description: `Swapped payer asset into settlement for payment ${transaction.paymentIntentId}`,
    reference: transaction.id,
    idempotencyKey: postingIdempotencyKey(transaction, "SWAPPED"),
    entries: [
      // The payer-asset legs cancel: the obligation is discharged by converting it.
      debit("PAYER_ASSET_OBLIGATION", held),
      credit("PAYER_ASSET_HELD", held),
      debit("TREASURY", output),
      credit("MERCHANT_PAYABLE", netAmount),
      credit("FEE_REVENUE", fee),
      ...fxEntries,
    ],
  };
}

/**
 * Gas Mayarin paid to execute a payment.
 *
 * Separate from `swapPosting` because it is denominated in the chain's native
 * asset and is a cost of operating, not part of the payment's value movement.
 * Posting it inside the swap would balance — native legs cancel among
 * themselves — but would state that the payer's conversion cost gas, when what
 * happened is that Mayarin spent its own.
 */
export function gasPosting(transaction: ClearingTransaction, cost: Money): DraftTransaction {
  return {
    description: `Gas paid to execute payment ${transaction.paymentIntentId}`,
    reference: transaction.id,
    idempotencyKey: postingIdempotencyKey(transaction, "GAS"),
    entries: [debit("GAS_EXPENSE", cost), credit("OPERATOR_GAS", cost)],
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

/**
 * A refund: value leaves Mayarin and the merchant's claim shrinks by the same
 * amount.
 *
 * ```
 * REFUND   Dr MERCHANT_HOLDING   (refund)
 *          Cr TREASURY           (refund)
 * ```
 *
 * `FEE_REVENUE` is untouched. The fee was earned on a payment that did happen,
 * and a partial refund would otherwise need the fee split proportionally — a
 * rounding rule with a residue to place, for money nobody expected back.
 *
 * Keyed by the refund's own id rather than by the transaction and a step: a
 * payment may have several refunds, so a per-transaction key would make the
 * second one a silent no-op.
 */
export function refundPosting(
  transaction: ClearingTransaction,
  refundId: string,
  amount: Money,
): DraftTransaction {
  const { netAmount } = requirePricedAmounts(transaction);

  if (amount.asset !== netAmount.asset) {
    throw new LedgerImbalanceError(
      `Refund for ${transaction.id} is ${amount.asset}, not the settlement asset ${netAmount.asset}`,
      { id: transaction.id, refund: amount.asset, settlement: netAmount.asset },
    );
  }

  return {
    description: `Refunded payment ${transaction.paymentIntentId}`,
    reference: transaction.id,
    idempotencyKey: `${refundId}:REFUND`,
    entries: [debit("MERCHANT_HOLDING", amount), credit("TREASURY", amount)],
  };
}

/**
 * The contract path's settlement, booked from what the chain reported.
 *
 * ```
 * SETTLED   Dr SETTLEMENT_IN_FLIGHT   (locked net)
 *           Cr TREASURY               (on-chain settled amount)
 *           Dr/Cr FX_RESULT           (the difference, when there is one)
 * ```
 *
 * The obligation is discharged in full — Mayarin owed the merchant the locked
 * net — and treasury is credited only what actually left. `FX_RESULT` names the
 * gap rather than absorbing it.
 *
 * **The sign runs opposite to `swapPosting`, and deliberately.** There, value
 * arrives into treasury, so beating the quote is a gain. Here value leaves, so
 * paying *less* than was owed is the gain and paying *more* is the loss. Both
 * are the same rule — a debit balance on `FX_RESULT` is a loss — applied to
 * flows running in opposite directions.
 *
 * `PaymentRouter` pays `minOut − fee` exactly, so the two should agree. A
 * payment where they do not is the point of recording it: silently posting the
 * quote would make a router that behaved unexpectedly indistinguishable from
 * one that did not.
 */
export function contractSettledPosting(
  transaction: ClearingTransaction,
  settled: Money,
): DraftTransaction {
  const { netAmount } = requirePricedAmounts(transaction);

  if (settled.asset !== netAmount.asset) {
    throw new LedgerImbalanceError(
      `On-chain settlement for ${transaction.id} is ${settled.asset}, not the settlement asset ${netAmount.asset}`,
      { id: transaction.id, settled: settled.asset, expected: netAmount.asset },
    );
  }

  const difference = settled.amount - netAmount.amount;
  const fxEntries =
    difference === 0n
      ? []
      : difference > 0n
        ? // Paid more than was owed: a loss.
          [debit("FX_RESULT", { amount: difference, asset: settled.asset })]
        : // Paid less than was owed: Mayarin kept the difference, a gain.
          [credit("FX_RESULT", { amount: -difference, asset: settled.asset })];

  return {
    description: `Settled payment ${transaction.paymentIntentId} on-chain`,
    reference: transaction.id,
    // Shares the SETTLED key with `settledPosting`: exactly one of the two runs
    // per transaction, so a resume replays the same posting as a no-op.
    idempotencyKey: postingIdempotencyKey(transaction, "SETTLED"),
    entries: [debit("SETTLEMENT_IN_FLIGHT", netAmount), credit("TREASURY", settled), ...fxEntries],
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

/**
 * The deposit path's postings are denominated in what the payer actually sent,
 * so they cannot be built for a transaction that has no deposit leg.
 */
function requireDepositAmount(transaction: ClearingTransaction): Money {
  const deposit = transaction.deposit;

  if (deposit === undefined) {
    throw new LedgerImbalanceError(
      `Clearing transaction ${transaction.id} has no deposit to post against`,
      { id: transaction.id, state: transaction.state },
    );
  }

  return deposit.amount;
}
