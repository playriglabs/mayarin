/** Replaces a stuck operator transaction under its own nonce with higher fees (SEC-04). */

import { isChainId } from "@mayarin/chain";
import type { OperatorTransactionBumper } from "@mayarin/shared";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  type LocalAccount,
} from "viem";

/** Nodes refuse a replacement priced under 10% more; 12.5% clears it with room. */
export const raise = (fee: bigint): bigint => fee + fee / 8n + 1n;

export function rpcOperatorBumper(
  account: LocalAccount,
  rpcUrls: Readonly<Partial<Record<string, string>>>,
): OperatorTransactionBumper {
  return {
    async bump(row) {
      // The sequencer's key is `${chain}:${address}`; chain names contain no colon.
      const chain = row.key.slice(0, row.key.indexOf(":"));
      const rpcUrl = isChainId(chain) ? rpcUrls[chain] : undefined;
      if (rpcUrl === undefined) throw new Error(`No RPC URL configured for ${chain}`);
      if (row.txHash === undefined) throw new Error(`Operator transaction ${row.id} has no hash`);

      const publicClient = createPublicClient({ transport: http(rpcUrl) });
      const walletClient = createWalletClient({ account, transport: http(rpcUrl) });
      const sent = await publicClient.getTransaction({ hash: row.txHash as Hex });
      const common = {
        account,
        to: row.call.to as Address,
        data: row.call.data as Hex,
        value: row.call.value,
        nonce: row.nonce,
        gas: sent.gas,
        chain: null,
      } as const;

      // Both fee fields must rise or the node rejects the replacement.
      if (sent.maxFeePerGas !== undefined && sent.maxPriorityFeePerGas !== undefined) {
        return walletClient.sendTransaction({
          ...common,
          maxFeePerGas: raise(sent.maxFeePerGas),
          maxPriorityFeePerGas: raise(sent.maxPriorityFeePerGas),
        });
      }
      if (sent.gasPrice === undefined) throw new Error(`No fee on ${row.txHash} to raise`);
      return walletClient.sendTransaction({ ...common, gasPrice: raise(sent.gasPrice) });
    },
  };
}
