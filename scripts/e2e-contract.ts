/** Payer-submitted contract path for e2e-deposit.ts --path on-chain-contract.
 * Shares registration and production engine wiring with the deposit runner.
 * The indexer's scan cursor is isolated so an audit never rewinds a worker.
 */
import { type ChainId, SettlementIndexer } from "@mayarin/chain";
import { InMemoryWatcherCursorRepository } from "@mayarin/chain/testing";
import type { ClearingTransaction } from "@mayarin/clearing";
import { createDatabase, DrizzleSettlementEventRepository } from "@mayarin/db";
import { EvmChainClient, EvmTreasuryExecutionPort } from "@mayarin/provider-evm";
import { systemClock, ValidationError } from "@mayarin/shared";
import type { Account, PublicClient, WalletClient } from "viem";
import type { Config } from "../apps/api/src/config.ts";
import type { Container } from "../apps/api/src/container.ts";

export async function runContractPayment(options: {
  readonly container: Container;
  readonly config: Config;
  readonly chain: ChainId;
  readonly locked: ClearingTransaction;
  readonly payer: Account;
  readonly publicClient: PublicClient;
  readonly walletClient: WalletClient;
}): Promise<void> {
  const { container, config, chain, locked, payer, publicClient, walletClient } = options;
  const order = locked.contract?.order;
  const input = locked.contract?.payerEstimate;
  if (
    chain !== "arc-testnet" ||
    order === undefined ||
    input === undefined ||
    config.contract === undefined
  ) {
    throw new ValidationError("Contract audit requires an Arc testnet contract lock", {});
  }
  if (input.asset !== "USDC" || order.refundTo.toLowerCase() !== payer.address.toLowerCase()) {
    throw new ValidationError("Audit requires same-asset USDC and the payer's refund address", {});
  }
  const rpcUrls = JSON.parse(process.env.CHAIN_RPC_URLS ?? "{}");
  const tokens = JSON.parse(process.env.CHAIN_ASSETS ?? "{}");
  const router = config.contract.paymentRouters[chain];
  if (router === undefined) throw new ValidationError("No Arc router configured", {});
  // Reuse the tested Permit2/call builder with the PAYER as sender. No sweep
  // and no treasury funding occur; only the indexer can complete the intent.
  const sender = new EvmTreasuryExecutionPort({
    clients: { [chain]: { publicClient, walletClient } },
    account: payer,
    lookup: {
      async indexFor() {
        return undefined;
      },
    },
    routes: {
      name: "same-asset-audit",
      async route() {
        throw new ValidationError("No swap in this audit", {});
      },
    },
    forwarderFactories: {},
    paymentRouters: config.contract.paymentRouters,
    tokens,
    nativeAssets: {},
    confirmations: { [chain]: 2 },
  });
  console.log(
    "contract order",
    order.intentId,
    "merchant",
    order.merchantSafe,
    "input",
    input.amount.toString(),
  );
  const submitted = await sender.execute({
    clearingTransactionId: locked.id,
    attempt: 1,
    chain,
    order,
    inputAmount: input,
  });
  console.log(
    "payer submission",
    JSON.stringify(submitted, (_, value) => (typeof value === "bigint" ? value.toString() : value)),
  );
  const receipt = await publicClient.getTransactionReceipt({
    hash: submitted.txHash as `0x${string}`,
  });
  const client = new EvmChainClient({ rpcUrls, tokens });
  const db = createDatabase({ url: config.databaseUrl });
  const indexer = new SettlementIndexer({
    client,
    settlements: new DrizzleSettlementEventRepository(db.db),
    cursors: new InMemoryWatcherCursorRepository(),
    sink: {
      async complete(intentId, completion) {
        if (intentId !== order.intentId) return false;
        await container.engine.recordPaymentCompleted(locked.id, completion);
        return true;
      },
    },
    clock: systemClock,
    policy: { depth: 2, reorgWatchWindow: 12 },
    routers: { [chain]: router },
    startBlocks: { [chain]: receipt.blockNumber - 1n },
    blockRange: 200,
  });
  for (let pass = 0; pass < 12; pass += 1) {
    const tick = await indexer.tick(chain);
    console.log(
      "indexer",
      JSON.stringify(tick, (_, value) => (typeof value === "bigint" ? value.toString() : value)),
    );
    const current = await container.engine.getById(locked.id);
    if (current.state === "SUCCESS") {
      const intent = await container.intents.getById(current.paymentIntentId);
      console.log(
        "contract evidence",
        JSON.stringify(
          {
            chain,
            intent: intent.id,
            intentStatus: intent.status,
            clearing: current.id,
            state: current.state,
            transaction: current.contract?.txHash,
          },
          null,
          2,
        ),
      );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  throw new ValidationError(
    "Payment was submitted but the indexer did not complete it; do not pay again",
    { clearingTransactionId: locked.id },
  );
}
