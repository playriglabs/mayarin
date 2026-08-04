/**
 * Deposit DTO — the payer's side of a payment.
 *
 * `received` counts CONFIRMED deposits only — it is the number the funding rule
 * uses, so showing anything else would explain the payment incorrectly.
 * `deposits` is the per-transfer record that makes a half-paid payment
 * diagnosable.
 */

import { type Deposit, isOrphanedAfterConfirmed } from "@mayarin/chain";
import type { ClearingTransaction } from "@mayarin/clearing";
import { zero } from "@mayarin/shared";
import { toMoneyDto } from "./money.ts";

export function toDepositDto(
  transaction: ClearingTransaction,
  deposits: readonly Deposit[],
  headNumber: bigint | undefined,
  requiredConfirmations: number,
) {
  const deposit = transaction.deposit;
  if (deposit === undefined) return null;

  const received = deposits
    .filter((entry) => entry.status === "CONFIRMED")
    .reduce(
      (total, entry) => ({
        amount: total.amount + entry.amount.amount,
        asset: deposit.asset,
      }),
      zero(deposit.asset),
    );

  return {
    address: deposit.address,
    chain: deposit.chain,
    asset: deposit.asset,
    amount: toMoneyDto(deposit.amount),
    received: toMoneyDto(received),
    required: requiredConfirmations,
    reviewRequired: deposits.some(isOrphanedAfterConfirmed),
    deposits: deposits.map((entry) => ({
      txHash: entry.txHash,
      logIndex: entry.logIndex,
      amount: toMoneyDto(entry.amount),
      status: entry.status,
      confirmations:
        headNumber === undefined || entry.blockNumber > headNumber
          ? 0
          : Number(headNumber - entry.blockNumber) + 1,
      firstSeenAt: entry.firstSeenAt.toISOString(),
    })),
  };
}

export type DepositDto = ReturnType<typeof toDepositDto>;
