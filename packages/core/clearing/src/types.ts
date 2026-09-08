import type { ChainId } from "@mayarin/chain";
import type { ExecutionPath } from "@mayarin/payment-intent";
import type { SettlementMerchant } from "@mayarin/settlement";
import type { AssetCode, Money } from "@mayarin/shared";
import type { ContractOrder } from "./contract-path.ts";

/**
 * Clearing state machine.
 *
 * The nine states from the README, plus `FAILED`. Without a failure state a
 * payment whose provider declined would have nowhere to go and would sit in
 * `SETTLING` forever; every other state is a step that can be resumed.
 */
export const CLEARING_STATES = [
  "CREATED",
  "QR_PARSED",
  "PRICE_LOCKED",
  "PAYMENT_PENDING",
  "ASSET_RECEIVED",
  "CLEARING",
  "SETTLING",
  "SETTLED",
  "SUCCESS",
  "FAILED",
] as const;

export type ClearingState = (typeof CLEARING_STATES)[number];

/** A rate frozen at `PRICE_LOCKED`, so the payer's quote cannot drift mid-payment. */
export interface LockedRate {
  readonly from: AssetCode;
  readonly to: AssetCode;
  /** Minor units of `to` per one whole unit of `from`. */
  readonly scaledRate: bigint;
  readonly source: string;
  readonly lockedAt: Date;
  readonly expiresAt?: Date;
}

/**
 * The payer's leg, frozen at PRICE_LOCKED.
 *
 * Set together or not at all — an address without a locked amount would tell a
 * payer where to send money but not how much.
 */
export interface ClearingDeposit {
  readonly asset: AssetCode;
  readonly chain: ChainId;
  readonly address: string;
  /** What the payer must send, in the payment asset. */
  readonly amount: Money;
  /** Quote asset → payment asset. */
  readonly rate: LockedRate;
}

export interface ClearingFailure {
  readonly reason: string;
  readonly code: string;
  readonly at: Date;
}

/**
 * The contract path's lock record, frozen at PRICE_LOCKED (#61).
 *
 * The counterpart of `ClearingDeposit` for the on-chain-contract path: the
 * signed order the checkout submits, the payer's display estimate, and the
 * quote deadline the engine enforces off-chain and the signed order deadline
 * the contract enforces on-chain. They differ for deposit payments, whose
 * execution window lasts through the payment-intent expiry.
 */
/** The settled, fee and refund legs a `PaymentCompleted` log reported. */
export interface OnChainSettlement {
  readonly settledAmount: Money;
  readonly fee: Money;
  readonly refundAmount: Money;
}

export interface ClearingContract {
  readonly order: ContractOrder;
  /** What the payer is shown, slippage-grossed. Never a custody lock. */
  readonly payerEstimate: Money;
  /** Quote freshness deadline; the signed order may remain executable longer. */
  readonly expiresAt: Date;
  /** Set when `PaymentCompleted` is recorded; doubles as `providerReference`. */
  readonly txHash?: string;
}

/**
 * The execution record of a payment.
 *
 * The payment intent says what is owed; this says how far along paying it we
 * are. One clearing transaction per intent.
 */
export interface ClearingTransaction {
  readonly id: string;
  readonly paymentIntentId: string;
  readonly state: ClearingState;
  readonly merchant: SettlementMerchant;
  /** What the merchant quoted, in their currency. */
  readonly sourceAmount: Money;
  readonly settlementAsset: AssetCode;
  readonly provider: string;
  /**
   * How the payer's rail is executed, copied from the intent at creation so
   * every step knows the path without reloading the intent (matching
   * `provider`). Absent for a fiat-only transaction.
   */
  readonly executionPath?: ExecutionPath;

  /** Set at PRICE_LOCKED. */
  readonly rate?: LockedRate;
  /** `sourceAmount` expressed in the settlement asset, frozen at PRICE_LOCKED. */
  readonly settlementAmount?: Money;
  /** Mayarin's fee, in the settlement asset. */
  readonly fee?: Money;
  /** What the merchant actually receives: settlement amount minus fee. */
  readonly netAmount?: Money;

  /** Set at PRICE_LOCKED when the intent names a payment rail. */
  readonly deposit?: ClearingDeposit;

  /** Set at PRICE_LOCKED on the on-chain-contract path (#61). */
  readonly contract?: ClearingContract;
  /**
   * What the chain says the settlement actually moved (#12).
   *
   * Recorded separately from the locked amounts rather than replacing them: a
   * payment where the two differ is the signal that a route behaved
   * unexpectedly, and overwriting the quote would erase the comparison. Present
   * on the contract path after `PaymentCompleted`, and on x402 after the
   * facilitator's direct transfer has been independently confirmed.
   */
  readonly onChain?: OnChainSettlement;

  /** Set at SETTLING, once the adapter has accepted the settlement. */
  readonly providerReference?: string;
  readonly failure?: ClearingFailure;

  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Optimistic concurrency token; also the count of transitions applied. */
  readonly version: number;
}

/**
 * One entry in a clearing transaction's append-only history.
 *
 * The event log is the audit trail: it explains not just where a payment is but
 * how it got there, which is what makes a stuck payment diagnosable.
 */
export interface ClearingEvent {
  readonly id: string;
  readonly clearingTransactionId: string;
  /** 1-based position in this transaction's history. */
  readonly sequence: number;
  readonly type: ClearingEventType;
  readonly fromState?: ClearingState;
  readonly toState: ClearingState;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
}

export const CLEARING_EVENT_TYPES = [
  "transaction.created",
  "state.changed",
  "state.failed",
  /**
   * A settlement transaction went out and has not been confirmed yet.
   *
   * The only event that records something without moving the transaction. It
   * exists because the alternative loses money: a facilitator broadcast whose
   * confirmation then throws leaves value moved on a chain and no pointer to it
   * anywhere, and EIP-3009 will not let the same authorization be sent twice.
   */
  "settlement.broadcast",
  /**
   * A cross-asset payment's swap went out and has not been confirmed yet.
   *
   * The twin of `settlement.broadcast`, one movement later. A cross-asset x402
   * payment (#211) has two chain transactions — the payer's authorization into
   * the operator, then the swap that pays the merchant — and only one of them
   * can be the settlement reference. This event is what says the reference has
   * moved on, so a resume confirms the swap instead of re-sending it. A swap
   * has no nonce to stop a second one: re-sending would spend the operator's
   * own balance and pay the merchant twice.
   */
  "settlement.swap",
  /** A refundable payer surplus was sent back and awaits chain confirmation. */
  "payer-surplus.refund.broadcast",
  /** The payer-surplus return was read back and its liability was cleared. */
  "payer-surplus.refund.confirmed",
] as const;
export type ClearingEventType = (typeof CLEARING_EVENT_TYPES)[number];
