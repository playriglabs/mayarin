/**
 * The merchant's refund of an escrow (#304), sent from their own wallet.
 *
 * The API builds the call — direct from the payee, or `Safe.execTransaction`
 * from the Safe's owner — and the factory accepts it only from the payee.
 */

import { Effect } from "effect";
import { paymentsApi } from "@/lib/api/payments";
import {
  type InjectedWallet,
  requestAccount,
  sendTransaction,
  switchChain,
  waitForReceipt,
} from "@/lib/wallet";

export async function refundEscrow(paymentId: string, wallet: InjectedWallet): Promise<void> {
  const account = await requestAccount(wallet.provider);
  const { chainId, transaction } = await Effect.runPromise(
    paymentsApi.escrowRefund(paymentId, account),
  );
  await switchChain(wallet.provider, BigInt(chainId));
  const hash = await sendTransaction(wallet.provider, transaction);
  await waitForReceipt(wallet.provider, hash);
}
