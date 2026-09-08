/**
 * Cross-asset settlement port (#211).
 *
 * The `exact` scheme is named for what it does to the payer: one signature, one
 * fixed amount, no second signature available. When the payer holds the
 * merchant's settlement asset that is the end of it — the authorization pays
 * the merchant and nothing else has to happen.
 *
 * When they do not, Mayarin's job is to turn that fixed input into the
 * merchant's invoiced output. `transferWithAuthorization` names one recipient,
 * chosen before the payer signs, so the payer's asset lands at the operator and
 * a swap moves it on. Two on-chain movements, because `PaymentRouter` cannot
 * serve this: it pulls through Permit2 from `msg.sender`, and an agent that only
 * signs is never the sender.
 *
 * The swap is **exact-output**. The merchant's number is the fixed one and the
 * payer's is derived, so the swap is asked to deliver exactly the invoice and
 * spend no more than the authorization — a venue that would overspend reverts
 * instead. Whatever it does not spend is the payer's, which is why `spent` is
 * reported rather than assumed: the difference is a balance somebody owns, and
 * absorbing it silently is the thing this port exists to prevent.
 */

import type { ChainId } from "@mayarin/chain";
import type { Money } from "@mayarin/shared";

export interface CrossAssetSwapRequest {
  /** The chain the authorization settled on, and the chain the swap executes on. */
  readonly chain: ChainId;
  /**
   * What the operator now holds, from the payer's authorization.
   *
   * The ceiling on the swap as well as the balance behind it: the payer signed
   * for this and nothing may spend past it.
   */
  readonly held: Money;
  /** Exactly what the merchant must receive. Not a minimum — the invoice. */
  readonly exactOut: Money;
  /** Where the merchant is paid, on this chain. */
  readonly recipient: string;
}

export interface CrossAssetSwap {
  /** The swap transaction, read back off the chain. */
  readonly transaction: string;
  /**
   * What the swap consumed of the payer's asset.
   *
   * Read back from the chain, never taken from the quote. The quote is what the
   * venue expected to spend; this is what it did, and the difference is the
   * payer's surplus.
   */
  readonly spent: Money;
  /** What the merchant received — `exactOut`, or this throws. */
  readonly delivered: Money;
}

/** The payer's change, returned after an exact-output swap consumed less than authorised. */
export interface PayerSurplusRefundRequest {
  readonly chain: ChainId;
  readonly amount: Money;
  readonly recipient: string;
}

export interface PayerSurplusRefund {
  /** The refund transaction, read back off the chain. */
  readonly transaction: string;
  /** Exactly what the operator returned to the payer. */
  readonly amount: Money;
}

/**
 * Swaps a payer's asset into the merchant's, exact-output.
 *
 * Implemented in `packages/providers/*` over a route source and a wallet, so
 * the network stays out of core. The swap has three methods rather than one,
 * and the split is the same one the facilitator already has for the same
 * reasons:
 *
 * - `plan` runs **before the payer's money moves**. A route that would need
 *   more than the authorization carries is unexecutable, and finding that out
 *   after `transferWithAuthorization` has landed leaves the payer's asset at the
 *   operator with the merchant unpaid and the nonce spent.
 * - `send` broadcasts and returns as soon as there is a hash, so the caller can
 *   persist it before trusting it. A swap has no nonce to stop a second one:
 *   re-sending spends the operator's own balance and pays the merchant twice.
 * - `confirm` reads the transaction back. Everything it reports comes off the
 *   receipt, which is what makes it evidence rather than a claim.
 *
 * Returning surplus repeats the durable half of that shape: send yields a hash
 * for the caller to persist, and confirm proves the exact payer received it.
 */
export interface CrossAssetSettler {
  /**
   * What a route expects to consume, or a throw if none can serve the pair.
   *
   * An estimate by nature — routes go stale faster than prices — so it bounds
   * the payment rather than committing to it. `send` routes again.
   */
  plan(request: CrossAssetSwapRequest): Promise<Money>;
  /** Broadcasts the swap and returns its hash, without waiting for a receipt. */
  send(request: CrossAssetSwapRequest): Promise<string>;
  /**
   * Reads a sent swap back. Throws when it reverted, is not there, or delivered
   * anything other than `exactOut` — none of which is a settled payment.
   */
  confirm(transaction: string, request: CrossAssetSwapRequest): Promise<CrossAssetSwap>;
  /** Broadcasts the payer-surplus return and yields its hash before confirmation. */
  sendRefund(request: PayerSurplusRefundRequest): Promise<string>;
  /** Reads back and verifies the exact amount and recipient of a sent refund. */
  confirmRefund(
    transaction: string,
    request: PayerSurplusRefundRequest,
  ): Promise<PayerSurplusRefund>;
}
