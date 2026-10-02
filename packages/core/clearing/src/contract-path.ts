/**
 * Contract execution path port (#61).
 *
 * The engine cannot import the quote engine — `@mayarin/quote` already
 * imports this package, and a cycle breaks the layering. So the contract
 * path arrives through a port: the composition root implements it from the
 * Phase 3 pieces (two-leg pricing, lock, order assembly, Turnkey signing)
 * and injects it, the same way the deposit layer is injected.
 *
 * The planner owns pricing and the fee: the fee inside the signed order is
 * what the contract splits on-chain, so it must come from the same place the
 * signature does. The engine checks the signed numbers against the lock and
 * refuses a planner that disagrees with itself.
 *
 * Building the router transaction is deliberately NOT here. A route goes
 * stale much faster than a price, so the checkout API fetches it per attempt
 * at submit time; the engine only needs the lock and the signal that the
 * payment completed on-chain.
 */

import type { ChainId } from "@mayarin/chain";
import type { EscrowRequest } from "@mayarin/payment-intent";
import { type AssetCode, MayarinError, type Money } from "@mayarin/shared";
import type { LockedRate } from "./types.ts";

/**
 * The signed EIP-712 order, complete, as the engine persists it with the
 * transaction. Complete on purpose: the checkout endpoint rebuilds the exact
 * struct the signature covers, so every signed field must be here.
 */
export interface ContractOrder {
  /** Backend-issued bytes32 hex; the contract consumes it on success. */
  readonly intentId: string;
  /** On-chain address of the settlement stablecoin the order settles in. */
  readonly settlementToken: string;
  /** The merchant's hard lock, gross, in settlement-asset minor units. */
  readonly minOut: bigint;
  /** The fee the contract splits out of `minOut`, in minor units. */
  readonly fee: bigint;
  /** Receives `minOut − fee`. For an escrowed order, the escrow address. */
  readonly merchantSafe: string;
  /** Receives execution excess and unconsumed input — the payer's address. */
  readonly refundTo: string;
  /** Unix seconds; on-chain `block.timestamp` must be `<= deadline`. */
  readonly deadline: bigint;
  readonly signature: string;
  /** The quote-signer address the contract verifies against. */
  readonly signer: string;
  /**
   * Present when `merchantSafe` is an escrow (#304). Unsigned by the router —
   * the terms are bound by the escrow address itself, which is
   * `EscrowFactory.escrowAddress(intentId, payer, payee, arbiter, releaseAfter, resolveBy)`.
   */
  readonly escrow?: ContractEscrow;
}

/**
 * The escrow an intent asked for, plus who the payer is. Not always the order's
 * `refundTo`: on deposit-match that is the treasury, and the payer is the
 * wallet they named.
 */
export interface EscrowLockRequest extends EscrowRequest {
  readonly payer: string;
}

/** The escrow terms besides the order's `intentId`. */
export interface ContractEscrow {
  /** `EscrowFactory` on this chain. */
  readonly factory: string;
  /** Releases or disputes; receives a refund. */
  readonly payer: string;
  /** The merchant's settlement address — where a release goes. */
  readonly payee: string;
  /** `0x000…0` when the terms name no arbiter. */
  readonly arbiter: string;
  /** Unix seconds after which an undisputed escrow is releasable by anyone. */
  readonly releaseAfter: bigint;
  /** Unix seconds after which a still-disputed escrow refunds the payer. */
  readonly resolveBy: bigint;
  /**
   * Settlement-token units the payer posts to dispute (#315). Present — even
   * as `0n` — when `factory` is `EscrowFactoryV2`; absent on a v1 escrow.
   */
  readonly bond?: bigint;
}

/** Everything `lock` freezes: the price, the signed order, and the display leg. */
export interface ContractLock {
  /** The merchant's settlement amount, gross — the signed `minOut`. */
  readonly settlementAmount: Money;
  /** Mayarin's fee, in the settlement asset — the signed `fee`. */
  readonly fee: Money;
  /** The executable rate the swap leg locked against, for the audit trail. */
  readonly rate: LockedRate;
  /** What the payer is shown, slippage-grossed. An estimate, never a lock. */
  readonly payerEstimate: Money;
  /** Quote freshness deadline; distinct from an overridden order deadline. */
  readonly expiresAt: Date;
  readonly order: ContractOrder;
}

export interface ContractLockRequest {
  readonly clearingTransactionId: string;
  readonly paymentIntentId: string;
  readonly merchantId: string;
  /** What the merchant quoted, in their currency. */
  readonly sourceAmount: Money;
  readonly settlementAsset: AssetCode;
  /** The asset the payer pays with, from the intent's rail. */
  readonly payerAsset: AssetCode;
  /** The chain the payment executes on, from the intent's rail. */
  readonly chain: ChainId;
  /** The payer's address, from the intent's rail — the order's `refundTo`. */
  readonly payerAddress: string;
  /** Settle into escrow instead of the merchant's address (#304). */
  readonly escrow?: EscrowLockRequest;
  /**
   * Who submits the PaymentRouter transaction.
   *
   * A connected payer pays network gas directly. A relayer pays it up front,
   * so the planner includes the configured gas reimbursement in the signed
   * fee. Because the router transfers that fee atomically, a reverted payment
   * charges the merchant nothing.
   */
  readonly submission: "payer" | "relayer";
  /**
   * Optional on-chain execution deadline, distinct from quote freshness.
   * Deposit payers may use the full payment-intent window to transfer funds;
   * connected-wallet payments leave this absent and use the quote deadline.
   */
  readonly orderExpiresAt?: Date;
}

/**
 * Prices both legs, locks, assembles and signs the order.
 *
 * `lock` is a side effect that runs before the state is persisted. A crash
 * in between means the resumed step locks again with a fresh order; the
 * orphaned order is harmless — the payer never saw it, and the contract
 * consumes an `intentId` only on success.
 */
export interface ContractPaymentPlanner {
  lock(request: ContractLockRequest): Promise<ContractLock>;
  /**
   * Re-signs a persisted order with a fresh deadline. Same economic terms —
   * same `intentId`, `minOut`, `fee`, recipients — so no party is asked to
   * consent to anything it did not already agree to.
   *
   * Deposit-match only. The relayer submits the order, so the old one never
   * left Mayarin and there is never a second live order in a payer's hands;
   * on-chain double execution is blocked by the router consuming `intentId`
   * (`AlreadyConsumed`). The connected-wallet path hands its order to the
   * payer and must not renew.
   */
  renew(request: ContractRenewRequest): Promise<ContractOrder>;
}

/**
 * Everything `renew` needs: the chain (the order itself carries none, and
 * the EIP-712 domain is per-chain), the persisted order to re-sign, and the
 * new execution deadline.
 */
export interface ContractRenewRequest {
  readonly chain: ChainId;
  readonly order: ContractOrder;
  /** The new execution deadline; floored to whole seconds like `assembleOrder`. */
  readonly expiresAt: Date;
}

/**
 * The persisted order's deadline has passed and no planner could renew it.
 * Terminal: an expired order cannot execute on-chain, and a re-sign is the
 * only way forward — so the payment fails with this reason rather than
 * burning attempts against a revert the contract is guaranteed to raise.
 */
export class OrderExpiredError extends MayarinError {
  readonly code = "ORDER_EXPIRED";
  readonly httpStatus = 410;
  override readonly retryable = false;
}
