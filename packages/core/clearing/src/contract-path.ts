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
import type { AssetCode, Money } from "@mayarin/shared";
import type { LockedRate } from "./types.ts";

/** The signed EIP-712 order fields the engine persists with the transaction. */
export interface ContractOrder {
  /** Backend-issued bytes32 hex; the contract consumes it on success. */
  readonly intentId: string;
  /** The merchant's hard lock, gross, in settlement-asset minor units. */
  readonly minOut: bigint;
  /** The fee the contract splits out of `minOut`, in minor units. */
  readonly fee: bigint;
  /** Unix seconds; on-chain `block.timestamp` must be `<= deadline`. */
  readonly deadline: bigint;
  readonly signature: string;
  /** The quote-signer address the contract verifies against. */
  readonly signer: string;
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
  /** The lock deadline; the engine fails the payment past it (plus grace). */
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
}
