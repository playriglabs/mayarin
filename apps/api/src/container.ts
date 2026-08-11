/**
 * Composition root.
 *
 * The only file that knows which concrete adapters this deployment runs. Every
 * package below it depends on ports, which is what keeps providers and storage
 * swappable.
 */

import { CatalogService, CheckoutService } from "@mayarin/catalog";
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
  type RateProvider,
  RefundService,
  TreasuryExecutor,
} from "@mayarin/clearing";
import {
  createDatabase,
  type DatabaseHandle,
  DrizzleApiKeyRepository,
  DrizzleClearingRepository,
  DrizzleDepositAddressRepository,
  DrizzleDepositRepository,
  DrizzleInternalSettlementStore,
  DrizzleInvoiceRepository,
  DrizzleLedgerRepository,
  DrizzleMarketConfigRepository,
  DrizzleMerchantAssetPolicySource,
  DrizzleMerchantRepository,
  DrizzleMerchantWalletRepository,
  DrizzlePaymentIntentRepository,
  DrizzlePaymentLinkRepository,
  DrizzleProductRepository,
  DrizzleRefundRepository,
  DrizzleSettlementEventRepository,
  DrizzleWatcherCursorRepository,
  DrizzleWebhookCursorRepository,
  DrizzleWebhookDeliveryRepository,
  DrizzleWebhookEndpointRepository,
  DrizzleWebhookOutbox,
  listenPaymentChanged,
} from "@mayarin/db";
import { InvoiceService } from "@mayarin/invoicing";
import { LedgerService } from "@mayarin/ledger";
import {
  type WebhookDeliveryRepository,
  WebhookDispatcher,
  type WebhookEndpointRepository,
} from "@mayarin/notifications";
import { type MerchantAssetPolicySource, PaymentIntentService } from "@mayarin/payment-intent";
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
import { pairsOf, type Stablecoin, type StablecoinRegistry } from "@mayarin/stablecoin";
import { SettlementAddressResolver, WalletGuard } from "@mayarin/wallet";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Config } from "./config.ts";
import { ApiContractPlanner, ContractCheckout, createRouteSources } from "./contract-layer.ts";
import { RuntimeMarket, RuntimePriceSource, RuntimeStablecoinRegistry } from "./market.ts";
import type { ApiKeyVerifier } from "./middleware/api-key.ts";
import type { QuoteLayer } from "./quote-layer.ts";
import { createApiKeyVerifier } from "./services/api-key-verifier.ts";
import { PaymentAppService } from "./services/payment.ts";
import { PaymentStream } from "./services/payment-stream.ts";
import { FetchWebhookTransport } from "./services/webhook-transport.ts";

export interface Container {
  readonly config: Config;
  /**
   * Resolves a bearer secret to the merchant scope its key grants (#14).
   *
   * The keys themselves are minted on the dashboard; this API only verifies
   * them, which is why the container carries a verifier and not the service.
   */
  readonly verifyApiKey: ApiKeyVerifier;
  readonly intents: PaymentIntentService;
  /** Products and payment links (#10). Optional to use, always wired. */
  readonly catalog: CatalogService;
  /** The one seam commerce crosses into payments: cart or link → intent. */
  readonly commerce: CheckoutService;
  /** Invoices: a payment link that also carries a buyer, a due date and a number (#112). */
  readonly invoices: InvoiceService;
  readonly ledger: LedgerService;
  readonly engine: ClearingEngine;
  /**
   * The rate provider the engine prices with (#15).
   *
   * Exposed so the indicative-quote route answers from the same source that
   * will later lock the price. A second provider wired for previews would show
   * a payer one number and charge them another.
   */
  readonly rates: RateProvider;
  readonly paymentApp: PaymentAppService;
  /** Refunds against settled payments (#12). */
  readonly refunds: RefundService;
  /**
   * Live payment status for the hosted checkout (#13).
   *
   * Absent when `REALTIME_ENABLED` is off, and the page falls back to polling —
   * which still works, so this is a degrade rather than a failure.
   */
  readonly stream?: PaymentStream;
  readonly adapters: SettlementAdapterRegistry;
  readonly events: EventPublisher;
  /** Admissible stablecoins and their on-chain identities. */
  readonly registry: StablecoinRegistry;
  /**
   * Per-merchant asset policy (#95).
   *
   * Exposed because the hosted checkout has to offer a payer the assets *this
   * merchant* accepts, not the deployment's whole admissible set — a buyer
   * offered an asset the merchant refuses gets the refusal after they have
   * decided.
   */
  readonly merchantPolicies: MerchantAssetPolicySource;
  /**
   * Market data held in the database rather than the environment (#95).
   *
   * Everything derived from it — the stablecoin registry, the rate table, the
   * quote layer — is rebuilt when it changes, so admitting a stablecoin or
   * adding an oracle feed does not need a restart.
   */
  readonly market: RuntimeMarket;
  /**
   * Which payout destinations this deployment will sign for (#11).
   *
   * Exposed so the entry point can ask its boot-time question — whether a fee
   * destination is also somebody's merchant wallet — before traffic arrives.
   */
  readonly walletGuard: WalletGuard;
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
  /** Outbound webhook delivery (RFC #13). Present only when `WEBHOOKS_ENABLED` is true. */
  readonly webhooks?: WebhookDispatcher;
  /** Endpoint configuration for the admin surface. Present with `webhooks`. */
  readonly webhookEndpoints?: WebhookEndpointRepository;
  /** Delivery inspection and replay for the admin surface. Present with `webhooks`. */
  readonly webhookDeliveries?: WebhookDeliveryRepository;
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

/**
 * Every `(chain, asset)` the watcher should poll.
 *
 * The stablecoin registry names the ERC-20s, and the chain's own currency is
 * not in it — a native asset has no contract to register. Both have to be
 * polled or an ETH rail issues a deposit address that nothing ever scans.
 */
export function watchedPairs(config: Config): readonly { chain: ChainId; asset: AssetCode }[] {
  const pairs = pairsOf(config.stablecoins).map((pair) => ({
    chain: pair.chain,
    asset: pair.asset,
  }));

  for (const [chain, asset] of Object.entries(config.chainNativeAssets)) {
    if (asset === undefined) continue;
    pairs.push({ chain: chain as ChainId, asset });
  }

  return pairs;
}

export function createContainer({
  config,
  clock = systemClock,
}: CreateContainerOptions): Container {
  const handle: DatabaseHandle = createDatabase({ url: config.databaseUrl });
  const events = new InMemoryEventBus();
  const chain = config.chain;

  // Market data lives in a table (#95). The registry handed to every service
  // below resolves the current one per call, so nothing under the composition
  // root learns that the admissible set can change while the process runs.
  const market = new RuntimeMarket({
    store: new DrizzleMarketConfigRepository(handle.db),
    config,
    clock,
  });
  const registry: StablecoinRegistry = new RuntimeStablecoinRegistry(market);

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

  const intentRepository = new DrizzlePaymentIntentRepository(handle.db);
  const intents = new PaymentIntentService({
    repository: intentRepository,
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

  // The commerce layer sits on top of intents and is never depended on by them:
  // a deployment that never writes a product row still takes every payment.
  const catalogProducts = new DrizzleProductRepository(handle.db);
  const catalogLinks = new DrizzlePaymentLinkRepository(handle.db);
  const catalog = new CatalogService({
    products: catalogProducts,
    links: catalogLinks,
    clock,
  });
  const commerce = new CheckoutService({
    products: catalogProducts,
    links: catalogLinks,
    intents,
    clock,
  });

  // Invoicing sits on top of checkout and is never depended on by it. The
  // intent repository doubles as the payment reader: an invoice's balance is
  // the sum of the intents carrying its number.
  const invoices = new InvoiceService({
    invoices: new DrizzleInvoiceRepository(handle.db),
    checkout: commerce,
    payments: intentRepository,
    clock,
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
    // Backed by Postgres, not memory: the engine asks this adapter what became
    // of a settlement it already recorded, and that question outlives the
    // process that answered the first one.
    new StablecoinSettlementAdapter({
      clock,
      store: new DrizzleInternalSettlementStore(handle.db),
    }),
  ]);

  const fees = new BasisPointsFeePolicy(config.feeBasisPoints);

  // `resolveContract` guarantees the quote layer is configured when the
  // contract block is, so the resolver below always yields one; the throw is
  // for the compiler, not a real branch.
  const resolveQuote = async (): Promise<QuoteLayer> => {
    const layer = await market.quote();
    if (layer === undefined) {
      throw new ConfigurationError("The quote layer is not configured on this deployment", {});
    }
    return layer;
  };

  // The signer's last chance to object to a payout destination (#11). Held on
  // the container as well as handed to the planner, because the same guard
  // answers the boot-time question: is a fee destination somebody's wallet?
  const merchantWallets = new DrizzleMerchantWalletRepository(handle.db);
  const walletGuard = new WalletGuard({
    wallets: merchantWallets,
    treasuryAddresses: config.treasuryAddress === undefined ? [] : [config.treasuryAddress],
  });

  const contractPlanner =
    config.contract !== undefined
      ? new ApiContractPlanner({
          contract: config.contract,
          quote: resolveQuote,
          fees,
          stablecoins: registry,
          merchantPolicies,
          wallets: walletGuard,
          // A merchant who never named their provisioned Safe is still paid at
          // it, rather than finding out at their first payment that a settings
          // field nobody mentioned was load-bearing.
          settlementAddresses: new SettlementAddressResolver({ wallets: merchantWallets }),
          clock,
        })
      : undefined;

  const treasuryExecutor = createTreasuryExecutor({
    config,
    ledger,
    depositAddresses,
  });

  const rates = new LiquidityRouter({ source: new RuntimePriceSource(market) });

  const engine = new ClearingEngine({
    repository: new DrizzleClearingRepository(handle.db),
    intents,
    ledger,
    adapters,
    rates,
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
          routeSources: async () =>
            createRouteSources(config, (await market.uniswapPools()) as Config["uniswapPools"]),
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
      nativeAssets: config.chainNativeAssets,
      logRange: chain.logRange,
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
          nativeBlockRange: chain.nativeBlockRange,
          retentionSeconds: chain.retentionSeconds,
          startBlocks: chain.startBlocks,
          // Which asset on this chain is the chain's own. Only that one gets the
          // balance reconciliation: an ERC-20 emits a Transfer log however it
          // moves, so `eth_getLogs` already sees an internal call. Native value
          // moved by a contract emits nothing at all.
          nativeAssets: config.chainNativeAssets,
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

  // Refunds run after the state machine has finished, against a transaction the
  // engine will never touch again — so a service beside it, not a step inside it.
  const clearingRepository = new DrizzleClearingRepository(handle.db);
  const refunds = new RefundService({
    clearing: clearingRepository,
    refunds: new DrizzleRefundRepository(handle.db),
    adapters,
    ledger,
    clock,
    events,
  });

  // One LISTEN connection per process, fanned out to the payers watching here.
  // A change committed by any instance reaches every instance; the in-process
  // event bus cannot cross that gap.
  const stream = config.realtimeEnabled
    ? new PaymentStream({
        subscribe: (onChange) => listenPaymentChanged(handle.sql, onChange),
        maxWatchedPayments: config.realtimeMaxWatched,
      })
    : undefined;

  const paymentApp = new PaymentAppService({
    intents,
    engine,
    ledger,
    ...(deposits === undefined ? {} : { deposits }),
    ...(chainHead === undefined ? {} : { chainHead }),
    ...(chain === undefined ? {} : { chainConfig: chain }),
  });

  // Delivery derives from the clearing event log the engine already writes, so
  // enabling webhooks wires nothing into the engine itself.
  let webhooks: WebhookDispatcher | undefined;
  let webhookEndpoints: WebhookEndpointRepository | undefined;
  let webhookDeliveries: WebhookDeliveryRepository | undefined;
  if (config.webhooksEnabled) {
    webhookEndpoints = new DrizzleWebhookEndpointRepository(handle.db);
    webhookDeliveries = new DrizzleWebhookDeliveryRepository(handle.db);
    webhooks = new WebhookDispatcher({
      outbox: new DrizzleWebhookOutbox(handle.db),
      cursor: new DrizzleWebhookCursorRepository(handle.db),
      endpoints: webhookEndpoints,
      deliveries: webhookDeliveries,
      transport: new FetchWebhookTransport(),
      clock,
    });
  }

  return {
    config,
    verifyApiKey: createApiKeyVerifier({ keys: new DrizzleApiKeyRepository(handle.db), clock }),
    intents,
    catalog,
    commerce,
    invoices,
    ledger,
    engine,
    rates,
    paymentApp,
    refunds,
    ...(stream === undefined ? {} : { stream }),
    adapters,
    events,
    registry,
    market,
    merchantPolicies,
    walletGuard,
    watchers,
    indexers,
    ...(deposits === undefined ? {} : { deposits }),
    ...(chainHead === undefined ? {} : { chainHead }),
    ...(checkout === undefined ? {} : { checkout }),
    ...(webhooks === undefined ? {} : { webhooks }),
    ...(webhookEndpoints === undefined ? {} : { webhookEndpoints }),
    ...(webhookDeliveries === undefined ? {} : { webhookDeliveries }),
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
