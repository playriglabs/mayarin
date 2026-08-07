/**
 * Composition root.
 *
 * The only file that knows which concrete adapters this deployment runs. Every
 * package below it depends on ports, which is what keeps providers and storage
 * swappable.
 */

import {
  type BlockRef,
  type ChainId,
  type PaymentCompletionSink,
  SettlementIndexer,
  WalletWatcher,
} from "@mayarin/chain";
import {
  BasisPointsFeePolicy,
  ClearingEngine,
  LiquidityRouter,
  TablePriceSource,
  TreasuryExecutor,
} from "@mayarin/clearing";
import {
  createDatabase,
  type DatabaseHandle,
  DrizzleClearingRepository,
  DrizzleDepositAddressRepository,
  DrizzleDepositRepository,
  DrizzleLedgerRepository,
  DrizzleMerchantAssetPolicySource,
  DrizzleMerchantRepository,
  DrizzlePaymentIntentRepository,
  DrizzleSettlementEventRepository,
  DrizzleWatcherCursorRepository,
} from "@mayarin/db";
import { LedgerService } from "@mayarin/ledger";
import { PaymentIntentService } from "@mayarin/payment-intent";
import {
  Create2DepositAddressDeriver,
  EvmChainClient,
  EvmTreasuryExecutionPort,
  HdDepositAddressDeriver,
} from "@mayarin/provider-evm";
import { MockSettlementAdapter } from "@mayarin/provider-mock";
import { StablecoinSettlementAdapter } from "@mayarin/provider-stablecoin";
import { SettlementAdapterRegistry } from "@mayarin/settlement";
import {
  type AssetCode,
  type Clock,
  ConfigurationError,
  type EventPublisher,
  InMemoryEventBus,
  systemClock,
} from "@mayarin/shared";
import {
  InMemoryStablecoinRegistry,
  pairsOf,
  type Stablecoin,
  type StablecoinRegistry,
} from "@mayarin/stablecoin";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Config } from "./config.ts";
import { ApiContractPlanner, ContractCheckout, createRouteSources } from "./contract-layer.ts";
import { createQuoteLayer, type QuoteLayer } from "./quote-layer.ts";
import { PaymentAppService } from "./services/payment.ts";

export interface Container {
  readonly config: Config;
  readonly intents: PaymentIntentService;
  readonly ledger: LedgerService;
  readonly engine: ClearingEngine;
  readonly paymentApp: PaymentAppService;
  readonly adapters: SettlementAdapterRegistry;
  readonly events: EventPublisher;
  /** Admissible stablecoins and their on-chain identities. */
  readonly registry: StablecoinRegistry;
  /**
   * One watcher per chain, because confirmation depth is per chain: a single
   * watcher would have to pick one depth and apply it to chains that do not
   * share it. Empty when the chain layer is off.
   */
  readonly watchers: ReadonlyMap<ChainId, WalletWatcher>;
  /** Present only when the chain layer is enabled. */
  readonly deposits?: DrizzleDepositRepository;
  /** Current head of a chain, for rendering confirmation counts. */
  readonly chainHead?: (chain: ChainId) => Promise<BlockRef>;
  /**
   * Venue-priced, oracle-guarded quoting and order signing. Present only when
   * `QUOTE_ENABLED` is true; without it the engine prices from the static
   * `EXCHANGE_RATES` table, which is the development default.
   */
  readonly quote?: QuoteLayer;
  /** Contract-path checkout (#61). Present only when `CONTRACT_PATH_ENABLED` is true. */
  readonly checkout?: ContractCheckout;
  /**
   * Ingests `PaymentCompleted` (#8), one per chain with a deployed router.
   *
   * Per chain for the same reason the watchers are: confirmation depth is a
   * per-chain fact, and a single indexer would have to pick one and apply it to
   * chains that do not share it. Empty unless the chain layer and the contract
   * path are both on — one reads the chain, the other says which router.
   */
  readonly indexers: ReadonlyMap<ChainId, SettlementIndexer>;
  close(): Promise<void>;
}

export interface CreateContainerOptions {
  readonly config: Config;
  readonly clock?: Clock;
}

/**
 * The chain treasury execution runs on.
 *
 * One chain today: `PAYMENT_ROUTERS` is validated to name at least one, and the
 * executor is wired per deployment rather than per payment. A multi-chain
 * operator would key the deriver by chain instead, which is a change to this
 * function and nothing else.
 */
function firstRouterChain(config: Config): ChainId {
  const [chain] = Object.keys(config.paymentRouters) as ChainId[];
  if (chain === undefined) {
    throw new ConfigurationError("No PAYMENT_ROUTERS configured", {});
  }
  return chain;
}

/**
 * Builds the treasury executor, or nothing when the deployment has no operator.
 *
 * `resolveContract` has already refused a half-configured executor, so the
 * narrowing here is for the compiler rather than a real branch.
 */
function createTreasuryExecutor(deps: {
  config: Config;
  ledger: LedgerService;
  depositAddresses: DrizzleDepositAddressRepository | undefined;
}): TreasuryExecutor | undefined {
  const { config, ledger, depositAddresses } = deps;

  if (!config.treasuryExecutionEnabled) return undefined;
  if (config.operatorPrivateKey === undefined || depositAddresses === undefined) return undefined;

  const chainId = firstRouterChain(config);
  const rpcUrl = config.chain?.rpcUrls[chainId];
  if (rpcUrl === undefined) {
    throw new ConfigurationError(`No CHAIN_RPC_URLS entry for ${chainId}`, { chain: chainId });
  }

  const account = privateKeyToAccount(config.operatorPrivateKey as `0x${string}`);
  const transport = http(rpcUrl);
  const routes = createRouteSources(config).values().next().value;

  if (routes === undefined) {
    throw new ConfigurationError("Treasury execution needs a route-capable venue", {});
  }

  const port = new EvmTreasuryExecutionPort({
    publicClient: createPublicClient({ transport }),
    walletClient: createWalletClient({ account, transport }),
    account,
    lookup: {
      async indexFor(clearingTransactionId) {
        const allocated = await depositAddresses.findByClearingTransactionId(clearingTransactionId);
        return allocated?.derivationIndex;
      },
    },
    routes,
    forwarderFactories: config.depositForwarders,
    paymentRouters: config.paymentRouters,
    tokens: config.chainAssets,
    // Every chain the router runs on is EVM, so the native asset is ETH.
    nativeAssets: Object.fromEntries(
      Object.keys(config.paymentRouters).map((chain) => [chain, "ETH" as AssetCode]),
    ),
    ...(config.chain?.confirmations[chainId] === undefined
      ? {}
      : { confirmations: config.chain.confirmations[chainId] }),
  });

  return new TreasuryExecutor({ port, ledger, maxAttempts: config.treasuryMaxAttempts });
}

export function createContainer({
  config,
  clock = systemClock,
}: CreateContainerOptions): Container {
  const handle: DatabaseHandle = createDatabase({ url: config.databaseUrl });
  const events = new InMemoryEventBus();
  const chain = config.chain;
  const registry = new InMemoryStablecoinRegistry(config.stablecoins);

  const depositAddresses =
    chain === undefined ? undefined : new DrizzleDepositAddressRepository(handle.db);
  // With treasury execution on, a deposit address must be a forwarder the
  // operator can deploy and sweep. An HD-derived EOA receives exactly the
  // quoted amount and cannot pay the gas to move it — the whole reason the
  // forwarder exists — so the deriver swaps rather than the port changing.
  const forwarderFactory = config.depositForwarders[firstRouterChain(config)];
  const depositDeriver =
    chain === undefined
      ? undefined
      : config.treasuryExecutionEnabled && forwarderFactory !== undefined
        ? new Create2DepositAddressDeriver({
            factory: forwarderFactory,
            initCodeHash: config.depositForwarderInitCodeHash ?? "0x",
          })
        : new HdDepositAddressDeriver({ xpub: chain.xpub });

  const merchantPolicies = new DrizzleMerchantAssetPolicySource(
    new DrizzleMerchantRepository(handle.db),
  );

  const intents = new PaymentIntentService({
    repository: new DrizzlePaymentIntentRepository(handle.db),
    clock,
    events,
    registry,
    // A merchant's own settlement asset outranks `config.settlementAsset`,
    // which stays as the fallback for a merchant that has not chosen one.
    merchantPolicies,
    defaults: {
      settlementAsset: config.settlementAsset,
      provider: config.defaultProvider,
      executionPath: config.executionPath,
      ttlSeconds: config.paymentIntentTtlSeconds,
    },
  });

  const ledger = new LedgerService({
    repository: new DrizzleLedgerRepository(handle.db, clock),
    clock,
  });

  const adapters = new SettlementAdapterRegistry([
    new MockSettlementAdapter({
      clock,
      ...(config.mockWebhookSecret === undefined
        ? {}
        : { webhookSecret: config.mockWebhookSecret }),
    }),
    new StablecoinSettlementAdapter({ clock }),
  ]);

  const quote = createQuoteLayer(config, clock);
  const fees = new BasisPointsFeePolicy(config.feeBasisPoints);

  // `resolveContract` guarantees the quote layer exists when the contract
  // block does; the narrowing here is for the compiler, not a real branch.
  const contractPlanner =
    config.contract !== undefined && quote !== undefined
      ? new ApiContractPlanner({
          contract: config.contract,
          quote,
          fees,
          stablecoins: registry,
          merchantPolicies,
          clock,
        })
      : undefined;

  const treasuryExecutor = createTreasuryExecutor({
    config,
    ledger,
    depositAddresses,
  });

  const engine = new ClearingEngine({
    repository: new DrizzleClearingRepository(handle.db),
    intents,
    ledger,
    adapters,
    rates: new LiquidityRouter({ source: new TablePriceSource(config.exchangeRates) }),
    fees,
    clock,
    events,
    autoConfirmAssetReceipt: config.assetReceiptMode === "auto",
    ...(depositAddresses === undefined ? {} : { depositAddresses }),
    ...(depositDeriver === undefined ? {} : { depositDeriver }),
    ...(contractPlanner === undefined ? {} : { contractPlanner }),
    ...(treasuryExecutor === undefined ? {} : { treasuryExecutor }),
    ...(config.treasuryAddress === undefined ? {} : { treasuryAddress: config.treasuryAddress }),
  });

  const checkout =
    config.contract === undefined
      ? undefined
      : new ContractCheckout({
          engine,
          intents,
          contract: config.contract,
          routeSources: createRouteSources(config),
          clock,
        });

  const watchers = new Map<ChainId, WalletWatcher>();
  let deposits: DrizzleDepositRepository | undefined;
  let chainHead: ((chain: ChainId) => Promise<BlockRef>) | undefined;

  if (chain !== undefined && depositAddresses !== undefined) {
    deposits = new DrizzleDepositRepository(handle.db);
    const client = new EvmChainClient({
      rpcUrls: chain.rpcUrls,
      tokens: tokensOf(config.stablecoins),
    });
    const cursors = new DrizzleWatcherCursorRepository(handle.db);
    chainHead = (id: ChainId) => client.head(id);

    // The watcher speaks to the engine through a sink rather than importing it:
    // `@mayarin/chain` must not depend on `@mayarin/clearing`.
    const sink = {
      fund: async (clearingTransactionId: string) => {
        await engine.recordAssetReceived(clearingTransactionId);
      },
    };

    for (const chainId of new Set(pairsOf(config.stablecoins).map((pair) => pair.chain))) {
      watchers.set(
        chainId,
        new WalletWatcher({
          client,
          addresses: depositAddresses,
          deposits,
          cursors,
          sink,
          clock,
          events,
          policy: {
            depth: chain.confirmations[chainId],
            reorgWatchWindow: chain.reorgWatchWindow,
          },
          blockRange: chain.blockRange,
          retentionSeconds: chain.retentionSeconds,
          startBlocks: chain.startBlocks,
        }),
      );
    }
  }

  // The seam #8 drives: the log names an on-chain `intentId`, and resolving it
  // to a clearing transaction is a clearing concern, so it happens here rather
  // than inside `@mayarin/chain`.
  const completionSink: PaymentCompletionSink = {
    complete: async (intentId, completion) => {
      const transaction = await engine.findByContractIntentId(intentId);
      if (transaction === null) return false;
      await engine.recordPaymentCompleted(transaction.id, completion);
      return true;
    },
  };

  const indexers = new Map<ChainId, SettlementIndexer>();
  if (chain !== undefined && config.contract !== undefined) {
    const settlementRepository = new DrizzleSettlementEventRepository(handle.db);
    const indexerCursors = new DrizzleWatcherCursorRepository(handle.db);
    const indexerClient = new EvmChainClient({
      rpcUrls: chain.rpcUrls,
      tokens: tokensOf(config.stablecoins),
    });

    for (const [routerChain, router] of Object.entries(config.contract.paymentRouters)) {
      if (router === undefined) continue;
      indexers.set(
        routerChain as ChainId,
        new SettlementIndexer({
          client: indexerClient,
          settlements: settlementRepository,
          cursors: indexerCursors,
          sink: completionSink,
          clock,
          policy: {
            // The same finality line a deposit gets: a settlement below the
            // depth has told the engine nothing and can vanish freely.
            depth: chain.confirmations[routerChain as ChainId],
            reorgWatchWindow: chain.reorgWatchWindow,
          },
          routers: { [routerChain]: router },
          blockRange: chain.blockRange,
          events,
          startBlocks: chain.startBlocks,
        }),
      );
    }
  }

  const paymentApp = new PaymentAppService({
    intents,
    engine,
    ledger,
    ...(deposits === undefined ? {} : { deposits }),
    ...(chainHead === undefined ? {} : { chainHead }),
    ...(chain === undefined ? {} : { chainConfig: chain }),
  });

  return {
    config,
    intents,
    ledger,
    engine,
    paymentApp,
    adapters,
    events,
    registry,
    watchers,
    indexers,
    ...(deposits === undefined ? {} : { deposits }),
    ...(chainHead === undefined ? {} : { chainHead }),
    ...(quote === undefined ? {} : { quote }),
    ...(checkout === undefined ? {} : { checkout }),
    close: () => handle.close(),
  };
}

/** Rebuilds the `chain → asset → address` token map the EVM client filters logs by. */
function tokensOf(
  stablecoins: readonly Stablecoin[],
): Partial<Record<ChainId, Partial<Record<AssetCode, string>>>> {
  const tokens: Partial<Record<ChainId, Partial<Record<AssetCode, string>>>> = {};
  for (const coin of stablecoins) {
    for (const entry of coin.onChain) {
      const perChain = tokens[entry.chain] ?? {};
      perChain[coin.asset] = entry.address;
      tokens[entry.chain] = perChain;
    }
  }
  return tokens;
}
