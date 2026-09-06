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
  CHAIN_IDS,
  type ChainClient,
  type ChainId,
  type PaymentCompletionSink,
  SettlementIndexer,
  type SettlementSource,
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
  DrizzleX402ResourceRepository,
  listenPaymentChanged,
} from "@mayarin/db";
import { FallbackRouteSource } from "@mayarin/execution";
import { InvoiceService } from "@mayarin/invoicing";
import { LedgerService } from "@mayarin/ledger";
import {
  type WebhookDeliveryRepository,
  WebhookDispatcher,
  type WebhookEndpointRepository,
} from "@mayarin/notifications";
import {
  DerivedRailCatalog,
  type MerchantAssetPolicySource,
  PaymentIntentService,
  type RailCatalog,
} from "@mayarin/payment-intent";
import {
  type ChainClients,
  Create2DepositAddressDeriver,
  EvmChainClient,
  EvmContractCodeReader,
  EvmTreasuryExecutionPort,
  HdDepositAddressDeriver,
} from "@mayarin/provider-evm";
import { MockSettlementAdapter } from "@mayarin/provider-mock";
import { StablecoinSettlementAdapter } from "@mayarin/provider-stablecoin";
import { SubgraphSettlementSource } from "@mayarin/provider-subgraph";
import {
  EvmAssetCapabilityProbe,
  EvmX402Reader,
  LocalX402Facilitator,
} from "@mayarin/provider-x402-local";
import { SettlementAdapterRegistry } from "@mayarin/settlement";
import {
  type AssetCode,
  type Clock,
  ConfigurationError,
  type EventPublisher,
  InMemoryEventBus,
  NotFoundError,
  systemClock,
} from "@mayarin/shared";
import { pairsOf, type Stablecoin, type StablecoinRegistry } from "@mayarin/stablecoin";
import { SettlementAddressResolver, WalletGuard } from "@mayarin/wallet";
import type {
  AssetCapabilityProbe,
  AssetPair,
  SettlementConfirmer,
  X402Facilitator,
} from "@mayarin/x402";
import { AssetCapabilities, facilitatorRegistry } from "@mayarin/x402";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Config } from "./config.ts";
import { ApiContractPlanner, ContractCheckout, createRouteSources } from "./contract-layer.ts";
import { RuntimeMarket, RuntimePriceSource, RuntimeStablecoinRegistry } from "./market.ts";
import type { ApiKeyVerifier } from "./middleware/api-key.ts";
import type { QuoteLayer } from "./quote-layer.ts";
import { chainReceipts, QuotePricingSource } from "./rails.ts";
import { createApiKeyVerifier } from "./services/api-key-verifier.ts";
import { PaymentAppService } from "./services/payment.ts";
import { PaymentStream } from "./services/payment-stream.ts";
import { FetchWebhookTransport } from "./services/webhook-transport.ts";
import { X402Service } from "./services/x402.ts";

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
   * Which `(chain, asset)` pairs a payer can actually be paid on (#244).
   *
   * One derivation serving the hosted checkout, the invoice page, the embed and
   * the SDK. Before it, the chain was whichever key came first in `CHAIN_ASSETS`
   * and the asset list was a union across every configured chain — so a payer on
   * Arc was offered ETH, which does not exist there.
   */
  readonly rails: RailCatalog;
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
  /**
   * The x402 rail (#207). Present only when `X402_ENABLED` is true.
   *
   * Optional for the same reason the contract path is: a deployment with no
   * facilitator has nothing to broadcast an authorization with, and the honest
   * answer to a request for a resource it cannot settle is that this deployment
   * does not serve one.
   */
  readonly x402?: X402Service;
  close(): Promise<void>;
}

export interface CreateContainerOptions {
  readonly config: Config;
  readonly clock?: Clock;
}

/**
 * The x402 rail, or nothing.
 *
 * Built per chain, because a facilitator is per chain: it holds one RPC
 * endpoint and broadcasts with one key against one network. The registry then
 * picks between them by what a `PaymentRequirements` names, which is why a
 * deployment with two chains configured needs no further wiring to serve both.
 *
 * Absent rather than broken when the pieces are missing. Without an operator
 * key there is nothing to broadcast an authorization with, and the honest
 * answer to a request for a resource this deployment cannot settle is that it
 * does not serve one.
 */
function createX402(deps: {
  config: Config;
  handle: DatabaseHandle;
  rates: RateProvider;
  intents: PaymentIntentService;
  engine: ClearingEngine;
  merchants: DrizzleMerchantRepository;
  merchantPolicies: MerchantAssetPolicySource;
  /** Absent on a deployment with `QUOTE_ENABLED=false`, which serves same-asset rails only. */
  quote: (() => Promise<QuoteLayer>) | undefined;
  clock: Clock;
}): X402Service | undefined {
  const { config, handle, rates, intents, engine, merchants, merchantPolicies, quote, clock } =
    deps;

  if (!config.x402Enabled) return undefined;
  if (config.operatorPrivateKey === undefined) return undefined;

  const rpcUrls = config.chain?.rpcUrls ?? {};
  const account = privateKeyToAccount(config.operatorPrivateKey as `0x${string}`);

  const facilitators: X402Facilitator[] = [];
  const confirmers = new Map<string, SettlementConfirmer>();
  const probes: AssetCapabilityProbe[] = [];

  for (const chain of CHAIN_IDS) {
    const rpcUrl = rpcUrls[chain];
    if (rpcUrl === undefined) continue;
    const transport = http(rpcUrl);
    const publicClient = createPublicClient({ transport });
    const reader = new EvmX402Reader({ chain, publicClient });
    probes.push(new EvmAssetCapabilityProbe({ chain, publicClient }));
    facilitators.push(
      new LocalX402Facilitator({
        chain,
        reader,
        publicClient,
        walletClient: createWalletClient({ account, transport }),
        account,
        clock,
        ...(config.chain?.confirmations[chain] === undefined
          ? {}
          : { confirmations: config.chain.confirmations[chain] }),
      }),
    );
    confirmers.set(reader.network, reader);
  }

  if (facilitators.length === 0) {
    throw new ConfigurationError(
      "X402_ENABLED is true but no chain has a CHAIN_RPC_URLS entry to broadcast against",
      {},
    );
  }

  return new X402Service({
    resources: new DrizzleX402ResourceRepository(handle.db),
    facilitators: facilitatorRegistry(facilitators),
    capabilities: new AssetCapabilities({
      probes,
      pairs: assetPairs(config.stablecoins, rpcUrls),
    }),
    confirmers,
    rates,
    intents,
    engine,
    clock,
    quoteTtlSeconds: config.x402QuoteTtlSeconds,
    /**
     * A merchant, as an intent records them.
     *
     * `city` and `countryCode` are optional on a merchant and required on a
     * snapshot — they arrive with a QRIS payload, and an x402 payment has no
     * QR. A merchant who has not set them is refused rather than given
     * placeholders: an intent carrying an invented country is a record that
     * reads as fact and is not one.
     */
    async merchantSnapshot(merchantId) {
      const merchant = await merchants.findById(merchantId);
      if (merchant === null) {
        throw new NotFoundError(`Merchant ${merchantId} not found`, { merchantId });
      }
      const { city, countryCode } = merchant;
      if (city === undefined || countryCode === undefined) {
        throw new ConfigurationError(
          `Merchant ${merchantId} needs a city and country code before x402 can price for them`,
          { merchantId },
        );
      }
      return { id: merchant.id, name: merchant.name, city, countryCode };
    },
    /**
     * The merchant's own choice outranks the deployment default, exactly as it
     * does for an intent. Reading it here is what tells a rail apart: an accept
     * naming this asset pays the merchant directly, and any other one is a swap.
     */
    async settlementAssetOf(merchantId) {
      const policy = await merchantPolicies.policyFor(merchantId);
      return policy?.settlementAsset ?? config.settlementAsset;
    },
    ...(quote === undefined ? {} : { quote }),
    operatorAddress: account.address,
  });
}

/**
 * Where each chain's settlements are read from.
 *
 * Per chain, and composed here rather than inside an adapter, because the two
 * sources answer for different chains in one deployment: a chain with a
 * `SUBGRAPH_ENDPOINTS` entry is served by the subgraph, and every other chain
 * keeps polling `eth_getLogs` exactly as before.
 *
 * `indexedHead` is the part that makes the substitution safe. The indexer moves
 * its cursor across the range it asked about, so a subgraph that has not caught
 * up must be able to say so; a client reading the chain cannot lag it and
 * answers `undefined`.
 */
function createSettlementSource(deps: {
  client: ChainClient;
  endpoints: Readonly<Partial<Record<ChainId, string>>>;
  routers: Readonly<Partial<Record<ChainId, string>>>;
}): SettlementSource {
  const { client, endpoints, routers } = deps;
  if (Object.keys(endpoints).length === 0) return client;

  const subgraph = new SubgraphSettlementSource({ endpoints, routers });
  const servesSubgraph = (chain: ChainId): boolean => endpoints[chain] !== undefined;

  return {
    settlements: (query) =>
      servesSubgraph(query.chain) ? subgraph.settlements(query) : client.settlements(query),
    indexedHead: async (chain) =>
      servesSubgraph(chain) ? await subgraph.indexedHead(chain) : undefined,
  };
}

/**
 * Every `(chain, token)` this deployment could be asked to settle in.
 *
 * Read off the stablecoin registry rather than a second list, and narrowed to
 * chains that have an RPC entry — a token on a chain nothing can reach is not a
 * pair a probe could describe, and warming it up would only produce an error
 * about configuration that is already absent on purpose.
 */
function assetPairs(
  stablecoins: readonly Stablecoin[],
  rpcUrls: Readonly<Partial<Record<ChainId, string>>>,
): readonly AssetPair[] {
  const pairs: AssetPair[] = [];
  for (const coin of stablecoins) {
    for (const entry of coin.onChain) {
      if (rpcUrls[entry.chain] === undefined) continue;
      pairs.push({ chain: entry.chain, contract: entry.address });
    }
  }
  return pairs;
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

  const account = privateKeyToAccount(config.operatorPrivateKey as `0x${string}`);

  // A client pair per router chain. One pair for the whole executor sent every
  // submission to whichever chain came first in `PAYMENT_ROUTERS` — so a sweep
  // on Arc went to Base's RPC, where the forwarder factory address has no code,
  // and the node answered `execution reverted` with nothing naming the chain.
  const clients: Partial<Record<ChainId, ChainClients>> = {};
  for (const chainId of Object.keys(config.paymentRouters) as ChainId[]) {
    const rpcUrl = config.chain?.rpcUrls[chainId];
    if (rpcUrl === undefined) {
      throw new ConfigurationError(`No CHAIN_RPC_URLS entry for ${chainId}`, { chain: chainId });
    }
    const transport = http(rpcUrl);
    clients[chainId] = {
      publicClient: createPublicClient({ transport }),
      walletClient: createWalletClient({ account, transport }),
    };
  }

  // Every configured venue, tried in order — not the first one. A deployment
  // with a V3 pool on Base and a V2 pool on Arc has both in the map, and
  // wiring only the first made every Arc deposit fail at execution with
  // "pool for EURC/USDC is on base-sepolia".
  const sources = [...createRouteSources(config).values()];

  if (sources.length === 0) {
    throw new ConfigurationError("Treasury execution needs a route-capable venue", {});
  }

  const routes = new FallbackRouteSource(sources);

  const port = new EvmTreasuryExecutionPort({
    clients,
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
    // Read from configuration rather than assumed to be ETH. It was ETH on every
    // chain a router had run on, and Arc's own currency is USDC — a gas cost
    // labelled ETH there is a ledger posting in an asset the chain does not
    // have. A chain that declares no native asset gets no gas posting at all.
    nativeAssets: config.chainNativeAssets,
    ...(config.chain === undefined ? {} : { confirmations: config.chain.confirmations }),
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
  // A deposit the worker will execute must be a forwarder even in the API
  // process, which intentionally has no operator key. Both processes derive
  // the same CREATE2 address from public deployment facts; only the worker can
  // deploy and sweep it. Falling back to an HD EOA here strands the deposit.
  // Every chain's factory, not the first one's. A CREATE2 deposit address is
  // derived from the factory that will deploy the forwarder, so deriving Arc's
  // address with Base's factory hands the payer an address the Arc sweep can
  // never reach — the funds arrive, the sweep deploys an empty forwarder
  // elsewhere and reports success, and the payment settles out of the operator's
  // own balance.
  const hasForwarders = Object.values(config.depositForwarders).some(
    (factory) => factory !== undefined,
  );
  const depositDeriver =
    chain === undefined
      ? undefined
      : hasForwarders && config.depositForwarderInitCodeHash !== undefined
        ? new Create2DepositAddressDeriver({
            factories: config.depositForwarders,
            initCodeHash: config.depositForwarderInitCodeHash,
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
  const relayerGasFees = new BasisPointsFeePolicy(config.relayerGasFeeBasisPoints);

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
  // One resolver, two readers: the signer asks it where to pay, and the rail
  // catalog asks it whether there is anywhere to pay at all on a chain.
  const settlementAddresses = new SettlementAddressResolver({ wallets: merchantWallets });
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
          relayerGasFees,
          stablecoins: registry,
          merchantPolicies,
          wallets: walletGuard,
          // A merchant who never named their provisioned Safe is still paid at
          // it, rather than finding out at their first payment that a settings
          // field nobody mentioned was load-bearing.
          settlementAddresses,
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
          tokenBalanceCatchUp: chain.tokenBalanceCatchUp,
          retentionSeconds: chain.retentionSeconds,
          startBlocks: chain.startBlocks,
          // Which asset on this chain is the chain's own. Native balance
          // reconciliation is always on; token catch-up is an explicit option.
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
    const settlementSource = createSettlementSource({
      client: indexerClient,
      endpoints: config.subgraphEndpoints,
      routers: config.contract.paymentRouters,
    });

    for (const [routerChain, router] of Object.entries(config.contract.paymentRouters)) {
      if (router === undefined) continue;
      indexers.set(
        routerChain as ChainId,
        new SettlementIndexer({
          client: indexerClient,
          source: settlementSource,
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

  // Built after the watchers, because a rail is only real when something is
  // scanning the chain it is on.
  const railCatalog = new DerivedRailCatalog({
    receipts: chainReceipts(config, new Set(watchers.keys())),
    merchantPolicies,
    // `effective` is exactly the port's question — where is this merchant paid
    // on this chain, or nowhere — under the name the resolver gave it before
    // the port existed. Adapted here rather than renamed there: the signer path
    // reads it under that name too.
    // Only where value actually lands on a chain. A deployment settling through
    // an off-chain adapter has no on-chain destination to have, and requiring
    // one there would offer a payer no rails at all.
    ...(config.contract === undefined && treasuryExecutor === undefined
      ? {}
      : {
          settlement: {
            destinationFor: (merchantId: string, railChain: ChainId, configured?: string) =>
              settlementAddresses.effective(merchantId, railChain, configured),
          },
        }),
    pricing: new QuotePricingSource({ market, rates, config }),
    defaultSettlementAsset: config.settlementAsset,
    // Absent with no RPC configured: a deployment settling off-chain cannot
    // strand funds at a contract address that does not exist on a chain.
    ...(Object.keys(config.chainRpcUrls).length === 0
      ? {}
      : { code: new EvmContractCodeReader({ rpcUrls: config.chainRpcUrls }) }),
  });

  const x402 = createX402({
    config,
    handle,
    rates,
    intents,
    engine,
    merchants: new DrizzleMerchantRepository(handle.db),
    merchantPolicies,
    quote: config.quote === undefined ? undefined : resolveQuote,
    clock,
  });

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
    rails: railCatalog,
    walletGuard,
    watchers,
    indexers,
    ...(deposits === undefined ? {} : { deposits }),
    ...(chainHead === undefined ? {} : { chainHead }),
    ...(checkout === undefined ? {} : { checkout }),
    ...(webhooks === undefined ? {} : { webhooks }),
    ...(webhookEndpoints === undefined ? {} : { webhookEndpoints }),
    ...(webhookDeliveries === undefined ? {} : { webhookDeliveries }),
    ...(x402 === undefined ? {} : { x402 }),
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
