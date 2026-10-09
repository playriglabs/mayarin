/**
 * Deposit DTO — the payer's side of a payment.
 *
 * `received` counts CONFIRMED deposits only — it is the number the funding rule
 * uses, so showing anything else would explain the payment incorrectly.
 * `deposits` is the per-transfer record that makes a half-paid payment
 * diagnosable.
 */

import {
  type ChainId,
  type Deposit,
  type DepositStatus,
  evmChainIdOf,
  isEvmChainId,
  isOrphanedAfterConfirmed,
  isSolanaChainId,
} from "@mayarin/chain";
import type { ClearingDeposit, ClearingTransaction } from "@mayarin/clearing";
import { encodeAddressUri } from "@mayarin/qr-parser";
import { type AssetCode, getAsset, toDecimalString, zero } from "@mayarin/shared";
import { type MoneyDto, toMoneyDto } from "./money.ts";

export function toDepositDto(
  transaction: ClearingTransaction,
  deposits: readonly Deposit[],
  headNumber: bigint | undefined,
  requiredConfirmations: number,
  /**
   * The ERC-20 contract the deposit asset lives at on this chain. Required for
   * a token deposit and absent for a native one — see `depositUri`.
   */
  token?: string,
): DepositDto {
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
    /** EIP-681 or Solana Pay transfer URI, for rendering as a wallet QR. */
    uri: depositUri(deposit, token),
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

/** `null` when the payment has no deposit address (the contract path, x402, fiat). */
export type DepositDto = {
  readonly address: string;
  readonly chain: ChainId;
  readonly asset: AssetCode;
  readonly amount: MoneyDto;
  readonly uri: string | null;
  readonly received: MoneyDto;
  readonly required: number;
  readonly reviewRequired: boolean;
  readonly deposits: readonly {
    readonly txHash: string;
    readonly logIndex: number;
    readonly amount: MoneyDto;
    readonly status: DepositStatus;
    readonly confirmations: number;
    readonly firstSeenAt: string;
  }[];
} | null;

/**
 * The payer-facing URI for a deposit, or `null` when one cannot be built.
 *
 * Native and token deposits take different EIP-681 forms, and the two are not
 * interchangeable — a token amount sent to the native form transfers ETH to a
 * token contract. So the form is chosen from the asset's own definition rather
 * than inferred from whether a token address happened to resolve: a stablecoin
 * whose address is missing yields no URI at all, because the alternative is a
 * URI that silently sends the wrong asset.
 */
export function depositUri(
  deposit: Pick<ClearingDeposit, "address" | "amount" | "asset" | "chain">,
  token: string | undefined,
): string | null {
  if (isSolanaChainId(deposit.chain)) {
    if (deposit.asset !== "SOL" && token === undefined) return null;
    const query = new URLSearchParams({ amount: toDecimalString(deposit.amount) });
    if (deposit.asset !== "SOL") query.set("spl-token", token ?? "");
    return `solana:${deposit.address}?${query.toString()}`;
  }
  if (!isEvmChainId(deposit.chain)) return null;
  const chainId = evmChainIdOf(deposit.chain);
  const request = {
    recipient: deposit.address,
    chainId,
    amount: deposit.amount,
  };

  // ETH is the native asset of every chain Mayarin watches; BTC is on no EVM
  // chain at all, so it names nothing transferable here.
  if (deposit.asset === "ETH") return encodeAddressUri(request);
  if (getAsset(deposit.asset).kind !== "stablecoin") return null;
  if (token === undefined || !/^0x[0-9a-fA-F]{40}$/.test(token)) return null;
  return encodeAddressUri({ ...request, token: token as `0x${string}` });
}
