import type { Address } from "viem";
import type { paymentRouterAbi } from "./abi.js";

/**
 * The on-chain `Order` struct, mirroring `IPaymentRouter.Order`. Field order
 * MUST match the EIP-712 typehash in `OrderHash.sol`:
 *
 *   Order(bytes32 intentId, uint256 minOut, uint256 fee, address merchantSafe,
 *         address refundTo, uint256 deadline)
 *
 * The Quote Engine (RFC #6) builds the typed-data payload from this shape; the
 * TS `Money.amount` bigint maps 1:1 onto the on-chain `uint256` minor units.
 */
export interface Order {
  readonly intentId: `0x${string}`;
  readonly minOut: bigint;
  readonly fee: bigint;
  readonly merchantSafe: Address;
  readonly refundTo: Address;
  readonly deadline: bigint;
}

/**
 * Decoded args of `PaymentCompleted`. `inputAsset` is `address(0)` for the native
 * `payEth` path. The Indexer (RFC #8) derives its idempotency key
 * `(chain, txHash, logIndex)` from the log itself; these args carry the settled
 * values it persists.
 */
export interface PaymentCompletedArgs {
  readonly intentId: `0x${string}`;
  readonly merchantSafe: Address;
  readonly refundTo: Address;
  readonly inputAsset: Address;
  readonly settlementAsset: Address;
  readonly inputAmount: bigint;
  readonly settledAmount: bigint;
  readonly fee: bigint;
  readonly refundAmount: bigint;
  readonly deadline: bigint;
}

/**
 * The narrowed `PaymentCompleted` AbiEvent, extracted from the generated ABI.
 * Pass it (or the full `paymentRouterAbi`) to viem's `decodeEventLog` /
 * `watchEvent` for typed log handling.
 */
export type PaymentCompletedEvent = Extract<
  (typeof paymentRouterAbi)[number],
  { type: "event"; name: "PaymentCompleted" }
>;
