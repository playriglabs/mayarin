import { usesDepositAddress } from "@mayarin/payment-intent";
import type { ClearingTransaction } from "./types.ts";

/**
 * Whether the merchant is paid on-chain by `PaymentRouter`, not by a settlement
 * adapter.
 *
 * True for the contract path, and for a deposit that the treasury executor
 * converted — the signed order is the marker, as it is for the receipt posting.
 * In both the router has already sent the net to the merchant's Safe by the time
 * the engine settles, so booking it as a balance Mayarin still owes would state a
 * liability that does not exist, and a refund would pay out of funds Mayarin
 * never held.
 */
export function settlesOnChain(transaction: ClearingTransaction): boolean {
  return (
    transaction.executionPath === "on-chain-contract" ||
    (transaction.contract !== undefined &&
      transaction.deposit !== undefined &&
      usesDepositAddress(transaction.executionPath))
  );
}
