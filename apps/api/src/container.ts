/**
 * Composition root.
 *
 * The only file that knows which concrete adapters this deployment runs. Every
 * package below it depends on ports, which is what keeps providers and storage
 * swappable.
 */

import { randomBytes } from "node:crypto";
import type { MerchantRepository } from "@mayarin/auth";
import { CatalogService, CheckoutService } from "@mayarin/catalog";
import {
  type BlockRef,
  type ChainClient,
  type ChainId,
  EVM_CHAINS,
  isChainId,
  isEvmChainId,
  isSolanaChainId,
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
  type TreasuryExecutionPort,
  TreasuryExecutor,
} from "@mayarin/clearing";
import {
  type AdminAuditRepository,
  createDatabase,
  type DatabaseHandle,
  DrizzleAdminAuditRepository,
  DrizzleApiKeyRepository,
  DrizzleClearingRepository,
  DrizzleCustomerRepository,
  DrizzleDenylist,
  DrizzleDepositAddressRepository,
  DrizzleDepositRepository,
  DrizzleEscrowDisputeRepository,
  DrizzleInternalSettlementStore,
  DrizzleInvoiceRepository,
  DrizzleLedgerRepository,
  DrizzleMarketConfigRepository,
  DrizzleMerchantAssetPolicySource,
  DrizzleMerchantRepository,
  DrizzleMerchantWalletRepository,
  DrizzleOperatorTransactionStore,
  DrizzlePayableQuoteRepository,
  DrizzlePaymentFundingRepository,
  DrizzlePaymentIntentRepository,
  DrizzlePaymentLinkRepository,
  DrizzleProductRepository,
  DrizzleRefundRepository,
  DrizzleRiskAssessments,
  DrizzleRiskHistory,
  DrizzleSettlementEventRepository,
  DrizzleSubscriptionRepository,
  DrizzleUserRepository,
  DrizzleWatcherCursorRepository,
  DrizzleWebhookCursorRepository,
  DrizzleWebhookDeliveryRepository,
  DrizzleWebhookEndpointRepository,
  DrizzleWebhookOutbox,
  DrizzleX402ResourceRepository,
  type Fence,
  listenPaymentChanged,
  type PaymentFundingRepository,
  PostgresNonceSequencer,
  SecretBox,
} from "@mayarin/db";
import { FallbackRouteSource } from "@mayarin/execution";
import { RiskAssessor } from "@mayarin/fraud";
import { PayerTokens } from "@mayarin/http";
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
  settlementAssetOnChain,
} from "@mayarin/payment-intent";
import {
  type ChainClients,
  Create2DepositAddressDeriver,
  ESCROW_CHAINS,
  EvmChainClient,
  EvmContractCodeReader,
  EvmCrossAssetSettler,
  EvmTreasuryExecutionPort,
  HdDepositAddressDeriver,
} from "@mayarin/provider-evm";
import { MockSettlementAdapter } from "@mayarin/provider-mock";
import {
  createSolanaConnection,
  LocalSolanaOrderSigner,
  OrcaSolanaRouteSource,
  SOLANA_SCAN_RANGE,
  SolanaDepositAddressDeriver,
  SolanaDepositClient,
  SolanaSettlementClient,
  SolanaTreasuryExecutionPort,
  solanaKeypairFromSecret,
} from "@mayarin/provider-solana";
import { StablecoinSettlementAdapter } from "@mayarin/provider-stablecoin";
import { createTransfiClient, type TransfiClient } from "@mayarin/provider-transfi";
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
  fromDecimalString,
  InMemoryEventBus,
  isAssetCode,
  type NonceSequencer,
  NotFoundError,
  OperatorFloatMonitor,
  OperatorTransactionReconciler,
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
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  http,
  parseAbi,
} from "viem";
import { type Config, isMainnetDeployment } from "./config.ts";
import {
  ApiContractPlanner,
  ContractCheckout,
  createRouteSources,
  RuntimeRouteSource,
} from "./contract-layer.ts";
import { RuntimeMarket, RuntimePriceSource, RuntimeStablecoinRegistry } from "./market.ts";
import type { ApiKeyVerifier } from "./middleware/api-key.ts";
import { operatorAccount } from "./operator-account.ts";
import type { QuoteLayer } from "./quote-layer.ts";
import { chainReceipts, QuotePricingSource } from "./rails.ts";
import { AnalyticsService } from "./services/analytics.ts";
import { createApiKeyVerifier } from "./services/api-key-verifier.ts";
import { disputeNotifier } from "./services/dispute-notifier.ts";
import { EscrowService } from "./services/escrow.ts";
import { disputeAlertSink } from "./services/escrow-dispute.ts";
import { EscrowKeeper, rpcEscrowStateReader } from "./services/escrow-keeper.ts";
import { FiatSettler } from "./services/fiat-settler.ts";
import { lifiGasRoute, rpcGasRefillPort } from "./services/gas-refill-chain.ts";
import { GasRefiller } from "./services/gas-refiller.ts";
import { LateDepositService } from "./services/late-deposits.ts";
import { rpcMerchantRegistry } from "./services/merchant-registry.ts";
import { rpcOperatorBumper } from "./services/operator-bumper.ts";
import { rpcOperatorChainReader } from "./services/operator-chain-reader.ts";
import { rpcFloatReader } from "./services/operator-float-reader.ts";
import { PaidNotifier } from "./services/paid-notifier.ts";
import { PayerStanding } from "./services/payer-standing.ts";
import { PaymentAppService } from "./services/payment.ts";
import { PaymentStream } from "./services/payment-stream.ts";
import { RiskGateService } from "./services/risk-gate.ts";
import { SubscriptionApiService } from "./services/subscriptions.ts";
import { PinnedWebhookTransport } from "./services/webhook-transport.ts";
import { X402Service } from "./services/x402.ts";
import { X402PayableService } from "./services/x402-payables.ts";

export interface Container {
  readonly config: Config;
  /**
   * Resolves a bearer secret to the merchant scope its key grants (#14).
   *
   * The keys themselves are minted on the dashboard; this API only verifies
   * them, which is why the container carries a verifier and not the service.
   */
  readonly verifyApiKey: ApiKeyVerifier;
  /** The payer's capability to one payment (SEC-09). */
  readonly payerTokens: PayerTokens;
  readonly intents: PaymentIntentService;
  /** Products and payment links (#10). Optional to use, always wired. */
  readonly catalog: CatalogService;
  /** The one seam commerce crosses into payments: cart or link → intent. */
  readonly commerce: CheckoutService;
  /** Invoices: a payment link that also carries a buyer, a due date and a number (#112). */
  readonly invoices: InvoiceService;
  /** Recurring plans (#296); the dashboard API's tick bills them. */
  readonly subscriptions: SubscriptionApiService;
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
  /** The dashboard's analytics figures, for the merchant API. */
  readonly analytics: AnalyticsService;
  /** Refunds against settled payments (#12). */
  readonly refunds: RefundService;
  /** Closes the operator key's sent-transaction rows once the chain settles them (SEC-04). */
  readonly operatorTransactions: OperatorTransactionReconciler;
  /** What the operator holds against its limits (SEC-06); absent without limits or an operator. */
  readonly operatorFloat?: OperatorFloatMonitor;
  /** Pulls stablecoin from the treasury Safe and swaps it to native gas; absent without `GAS_REFILL`. */
  readonly gasRefiller?: GasRefiller;
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
  /** Merchant records, read for the logo an invoice or receipt PDF carries. */
  readonly merchants: MerchantRepository;
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
   * Prices every rail ahead of anyone asking, so the first buyer after a restart (or after
   * the answers aged out) does not wait for it. Absent where there is no pricing to warm.
   */
  readonly warmRailPricing?: () => Promise<void>;
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
  /** Funds that arrived after their payment expired; present with the chain layer. */
  readonly lateDeposits?: LateDepositService;
  /** Current head of a chain, for rendering confirmation counts. */
  readonly chainHead?: (chain: ChainId) => Promise<BlockRef>;
  /** Contract-path checkout (#61). Present only when `CONTRACT_PATH_ENABLED` is true. */
  readonly checkout?: ContractCheckout;
  /** Escrow state and calldata for a conditional-settlement payment (#304). */
  readonly escrow: EscrowService;
  /** Whether a payer wallet may still take buyer protection (#314). */
  readonly payerStanding: PayerStanding;
  /** Fraud detection: what the rules flagged, and the addresses nobody may pay from. */
  readonly riskAssessments: Pick<DrizzleRiskAssessments, "listFlagged">;
  readonly denylist: Pick<DrizzleDenylist, "add" | "remove">;
  /** Local-currency funding of a deposit address; present only with the TRANSFI_* env set. */
  readonly transfi?: TransfiClient;
  /** How each payment was funded when its payer's own wallet did not. */
  readonly paymentFundings: PaymentFundingRepository;
  /** The deployment's clock, for edge code that stamps a record. */
  readonly clock: Clock;
  /** Append-only record of every admin-surface call (SEC-14). */
  readonly adminAudit: AdminAuditRepository;
  /** Sandbox demos only: finishes a local-currency payment. Absent unless switched on. */
  readonly fiatSettler?: FiatSettler;
  /**
   * Closes escrows whose hold or arbitration window has ended (#304). Present
   * only with treasury execution, whose operator key sends the calls.
   */
  readonly escrowKeeper?: EscrowKeeper;
  /** "You got paid" emails; absent without `RESEND_API_KEY`. */
  readonly paidNotices?: PaidNotifier;
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
  /**
   * Payables on the x402 rail (#273): invoices and payment links an agent can
   * quote and pay without meeting the merchant first. Present with `x402`,
   * which is the only thing it can settle through.
   */
  readonly x402Payables?: X402PayableService;
  close(): Promise<void>;
}

export interface CreateContainerOptions {
  readonly config: Config;
  readonly clock?: Clock;
  /**
   * The worker lease this process holds, for the nonce sequencer to check: a
   * broadcast is refused once a newer lease supersedes it (SEC-04). Only the
   * chain worker has one.
   */
  readonly fence?: Fence;
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
/** `{"USDC":"500"}` in whole units, as the engine takes it: minor units per asset. */
function minorLimits(limits: Readonly<Record<string, string>>): Partial<Record<AssetCode, bigint>> {
  return Object.fromEntries(
    Object.entries(limits).map(([asset, value]) => [
      asset,
      fromDecimalString(value, asset as AssetCode).amount,
    ]),
  );
}

/** The routers the cross-asset settler may approve and call, per chain (SEC-17). */
function allowedSwapRouters(config: Config): Partial<Record<ChainId, readonly string[]>> {
  const allowed: Partial<Record<ChainId, string[]>> = {};
  const add = (chain: string, address: string): void => {
    if (!isChainId(chain)) return;
    allowed[chain] = [...(allowed[chain] ?? []), address];
  };
  for (const [chain, address] of Object.entries(config.uniswapSwapRouters)) {
    if (address !== undefined) add(chain, address);
  }
  for (const [chain, address] of Object.entries(config.uniswapV2Routers)) {
    if (address !== undefined) add(chain, address);
  }
  for (const [chain, addresses] of Object.entries(config.swapRouterAllowlist)) {
    for (const address of addresses ?? []) add(chain, address);
  }
  return allowed;
}

function createX402(deps: {
  config: Config;
  handle: DatabaseHandle;
  rates: RateProvider;
  intents: PaymentIntentService;
  engine: ClearingEngine;
  merchants: DrizzleMerchantRepository;
  merchantPolicies: MerchantAssetPolicySource;
  /** Where a cross-asset swap delivers: the merchant's own address on that chain. */
  settlementAddresses: SettlementAddressResolver;
  /** Absent on a deployment with `QUOTE_ENABLED=false`, which serves same-asset rails only. */
  quote: (() => Promise<QuoteLayer>) | undefined;
  /** The merchant's rails, as a payable's `402` derives its `accepts` from. */
  merchantRails: DerivedRailCatalog;
  /** The quote lock behind a payable (#273). Shared with `x402Payables`. */
  payableQuotes: DrizzlePayableQuoteRepository;
  /** The runtime pool set (#95), read per swap so execution matches pricing. */
  uniswapPools: () => Promise<Config["uniswapPools"]>;
  /** One counter for every submitter of the operator key, across processes. */
  nonces: NonceSequencer;
  clock: Clock;
}): X402Service | undefined {
  const {
    config,
    handle,
    rates,
    intents,
    engine,
    merchants,
    merchantPolicies,
    settlementAddresses,
    quote,
    merchantRails,
    payableQuotes,
    uniswapPools,
    nonces,
    clock,
  } = deps;

  if (!config.x402Enabled) return undefined;
  const account = operatorAccount(config);
  if (account === undefined) return undefined;

  const rpcUrls = config.chain?.rpcUrls ?? {};

  // The swap half of a cross-asset rail, and its absence is what keeps such a
  // rail out of the `402`. A deployment with no route-capable venue simply does
  // not offer one, rather than pricing a payment it could not execute.
  // Resolved per swap from the runtime pools (#95), like the treasury executor:
  // a pool added through the admin API must execute wherever it prices.
  const routeSources =
    createRouteSources(config).size === 0 ? [] : [new RuntimeRouteSource(config, uniswapPools)];
  const crossAssetSettler =
    routeSources.length === 0
      ? undefined
      : new EvmCrossAssetSettler({
          nonces,
          allowedRouters: allowedSwapRouters(config),
          clients: Object.fromEntries(
            Object.entries(rpcUrls).flatMap(([chainId, rpcUrl]) => {
              if (rpcUrl === undefined || !isEvmChainId(chainId)) return [];
              const transport = http(rpcUrl);
              return [
                [
                  chainId,
                  {
                    publicClient: createPublicClient({ transport }),
                    walletClient: createWalletClient({ account, transport }),
                  },
                ],
              ];
            }),
          ),
          account,
          routes: new FallbackRouteSource(routeSources),
          tokens: config.chainAssets,
          ...(config.chain === undefined ? {} : { confirmations: config.chain.confirmations }),
        });

  const facilitators: X402Facilitator[] = [];
  const confirmers = new Map<string, SettlementConfirmer>();
  const probes: AssetCapabilityProbe[] = [];

  for (const chain of EVM_CHAINS) {
    const rpcUrl = rpcUrls[chain];
    if (rpcUrl === undefined) continue;
    const transport = http(rpcUrl);
    const publicClient = createPublicClient({ transport });
    const reader = new EvmX402Reader({ chain, publicClient });
    probes.push(new EvmAssetCapabilityProbe({ chain, publicClient }));
    facilitators.push(
      new LocalX402Facilitator({
        chain,
        nonces,
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
      // CHAIN_ASSETS also contains cross-asset PaymentRouter inputs. Those use
      // Permit2 and need no token-owned EIP-712 domain, so warming every one as
      // an x402 token made an otherwise valid PYUSD input prevent API startup.
      // Warm only assets this deployment admits for direct settlement; other
      // x402 candidates are still probed on demand and dropped when unsupported.
      pairs: assetPairs(config.stablecoins, rpcUrls, config.settlementAssets),
    }),
    confirmers,
    rates,
    intents,
    engine,
    clock,
    quoteTtlSeconds: config.x402QuoteTtlSeconds,
    merchantRails,
    payableQuotes,
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
    async settlementAssetOf(merchantId, chain) {
      const policy = await merchantPolicies.policyFor(merchantId);
      return policy === undefined ? config.settlementAsset : settlementAssetOnChain(policy, chain);
    },
    ...(quote === undefined ? {} : { quote }),
    operatorAddress: account.address,
    ...(crossAssetSettler === undefined ? {} : { crossAssetSettler }),
    /**
     * Where the swap delivers. Not the rail's `payTo` — that one is the
     * operator's, because the payer's asset had to land somewhere swappable.
     */
    async settlementAddressOf(merchantId, chain) {
      const policy = await merchantPolicies.policyFor(merchantId);
      return settlementAddresses.effective(merchantId, chain, policy?.settlementAddress);
    },
  });
}

/**
 * Every `(chain, token)` this deployment could be asked to settle in.
 *
 * Read off the stablecoin registry rather than a second list, and narrowed to
 * chains that have an RPC entry — a token on a chain nothing can reach is not a
 * pair a probe could describe, and warming it up would only produce an error
 * about configuration that is already absent on purpose.
 */
export function assetPairs(
  stablecoins: readonly Stablecoin[],
  rpcUrls: Readonly<Partial<Record<ChainId, string>>>,
  settlementAssets: readonly string[],
): readonly AssetPair[] {
  return stablecoins
    .filter((coin) => settlementAssets.includes(coin.asset))
    .flatMap((coin) =>
      coin.onChain
        .filter((entry) => rpcUrls[entry.chain] !== undefined)
        .map((entry) => ({ chain: entry.chain, contract: entry.address })),
    );
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
  solanaRuntime:
    | {
        readonly connections: Readonly<
          Partial<Record<ChainId, ReturnType<typeof createSolanaConnection>>>
        >;
        readonly deploymentDomains: Readonly<Partial<Record<ChainId, Uint8Array>>>;
        readonly feeRecipients: Readonly<Partial<Record<ChainId, string>>>;
        readonly routeSources: Readonly<Partial<Record<ChainId, OrcaSolanaRouteSource>>>;
      }
    | undefined;
  /** The runtime pool set (#95), read per swap so execution matches pricing. */
  uniswapPools: () => Promise<Config["uniswapPools"]>;
  nonces: NonceSequencer;
  /** What the settlement indexer has recorded, for a payment the router already settled. */
  settlements: DrizzleSettlementEventRepository;
}):
  | {
      executor: TreasuryExecutor;
      evmPort: EvmTreasuryExecutionPort | undefined;
      chains: Set<ChainId>;
    }
  | undefined {
  const { config, ledger, depositAddresses, solanaRuntime, uniswapPools, nonces, settlements } =
    deps;

  if (!config.treasuryExecutionEnabled) return undefined;
  if (depositAddresses === undefined) return undefined;
  const evmChains = Object.keys(config.depositForwarders).filter(isEvmChainId);
  const solanaChains = Object.keys(config.contract?.paymentRouters ?? {}).filter(isSolanaChainId);
  const account = evmChains.length === 0 ? undefined : operatorAccount(config);

  // A client pair per router chain. One pair for the whole executor sent every
  // submission to whichever chain came first in `PAYMENT_ROUTERS` — so a sweep
  // on Arc went to Base's RPC, where the forwarder factory address has no code,
  // and the node answered `execution reverted` with nothing naming the chain.
  const clients: Partial<Record<ChainId, ChainClients>> = {};
  for (const chainId of evmChains) {
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
  if (evmChains.length > 0 && createRouteSources(config).size === 0) {
    throw new ConfigurationError("Treasury execution needs a route-capable venue", {});
  }

  const routes = new RuntimeRouteSource(config, uniswapPools);

  const lookup = {
    async indexFor(clearingTransactionId: string) {
      const allocated = await depositAddresses.findByClearingTransactionId(clearingTransactionId);
      return allocated?.derivationIndex;
    },
  };
  const evmPort =
    account === undefined
      ? undefined
      : new EvmTreasuryExecutionPort({
          nonces,
          clients,
          account,
          lookup,
          routes,
          forwarderFactories: config.depositForwarders,
          paymentRouters: config.paymentRouters,
          tokens: config.chainAssets,
          nativeAssets: config.chainNativeAssets,
          ...(config.chain === undefined ? {} : { confirmations: config.chain.confirmations }),
          // A reorged settlement says nothing about what is on chain now.
          settledBefore: async (chain, intentId) => {
            const event = await settlements.findByIntentId(intentId);
            return event === null || event.chain !== chain || event.status === "ORPHANED"
              ? undefined
              : event;
          },
        });
  const solanaConfig = config.contract?.solana;
  const depositSeed = config.chain?.solanaDepositSeed;
  const solanaPort =
    solanaChains.length === 0 ||
    solanaRuntime === undefined ||
    solanaConfig === undefined ||
    depositSeed === undefined
      ? undefined
      : new SolanaTreasuryExecutionPort({
          connections: solanaRuntime.connections,
          depositSeed,
          feePayer: solanaKeypairFromSecret(solanaConfig.signerSecretKey),
          lookup,
          paymentRouters: config.paymentRouters,
          deploymentDomains: solanaRuntime.deploymentDomains,
          feeRecipients: solanaRuntime.feeRecipients,
          tokens: config.chainAssets,
          nativeAssets: config.chainNativeAssets,
          routeSources: solanaRuntime.routeSources,
        });
  const portFor = (chain: ChainId): TreasuryExecutionPort => {
    const selected = isSolanaChainId(chain) ? solanaPort : evmPort;
    if (selected === undefined) {
      throw new ConfigurationError(`No treasury execution port configured for ${chain}`, { chain });
    }
    return selected;
  };
  const port: TreasuryExecutionPort = {
    sweep: (request) => portFor(request.chain).sweep(request),
    execute: (request) => portFor(request.chain).execute(request),
  };
  const chains = new Set<ChainId>([
    ...evmChains,
    ...(solanaPort === undefined ? [] : (solanaChains as ChainId[])),
  ]);
  if (chains.size === 0) return undefined;

  return {
    executor: new TreasuryExecutor({ port, ledger, maxAttempts: config.treasuryMaxAttempts }),
    evmPort,
    chains,
  };
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

/**
 * TransFi is all or nothing: a half-set `TRANSFI_*` would otherwise disable the
 * local-currency option silently, and the payer would never learn why it is gone.
 */
function transfiClientOf(config: Config): TransfiClient | undefined {
  const { transfiBaseUrl, transfiMid, transfiUsername, transfiPassword } = config;
  const set = [transfiBaseUrl, transfiMid, transfiUsername, transfiPassword].filter(
    (value) => value !== undefined,
  );
  if (set.length === 0) return undefined;
  if (
    transfiBaseUrl === undefined ||
    transfiMid === undefined ||
    transfiUsername === undefined ||
    transfiPassword === undefined
  ) {
    throw new ConfigurationError(
      "TRANSFI_BASE_URL, TRANSFI_MID, TRANSFI_USERNAME and TRANSFI_PASSWORD must be set together",
      {},
    );
  }
  return createTransfiClient({
    baseUrl: transfiBaseUrl,
    mid: transfiMid,
    username: transfiUsername,
    password: transfiPassword,
  });
}

export function createContainer({
  config,
  clock = systemClock,
  fence,
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

  const hasOnChainAssets = pairsOf(config.stablecoins).length > 0;
  const depositAddresses =
    chain === undefined || !hasOnChainAssets
      ? undefined
      : new DrizzleDepositAddressRepository(handle.db);
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
  const evmDepositDeriver =
    chain === undefined
      ? undefined
      : hasForwarders && config.depositForwarderInitCodeHash !== undefined
        ? new Create2DepositAddressDeriver({
            factories: config.depositForwarders,
            initCodeHash: config.depositForwarderInitCodeHash,
          })
        : new HdDepositAddressDeriver({ xpub: chain.xpub });
  const solanaDepositDeriver =
    chain?.solanaDepositSeed === undefined
      ? undefined
      : new SolanaDepositAddressDeriver({ seed: chain.solanaDepositSeed });
  const depositDeriver =
    evmDepositDeriver === undefined && solanaDepositDeriver === undefined
      ? undefined
      : {
          derive: (index: number, chainId: ChainId): string => {
            if (isSolanaChainId(chainId)) {
              if (solanaDepositDeriver === undefined) {
                throw new ConfigurationError(`No Solana deposit seed configured for ${chainId}`, {
                  chain: chainId,
                });
              }
              return solanaDepositDeriver.derive(index);
            }
            if (evmDepositDeriver === undefined) {
              throw new ConfigurationError(`No EVM deposit deriver configured for ${chainId}`, {
                chain: chainId,
              });
            }
            return evmDepositDeriver.derive(index, chainId);
          },
        };

  const merchants = new DrizzleMerchantRepository(handle.db);
  const merchantPolicies = new DrizzleMerchantAssetPolicySource(merchants);

  const disputes = new DrizzleEscrowDisputeRepository(handle.db);
  const payerStanding = new PayerStanding(disputes, () => market.disputeStanding());
  const transfi = transfiClientOf(config);
  const paymentFundings = new DrizzlePaymentFundingRepository(handle.db);

  // Built before the intent service: the fraud gate announces a flagged payment
  // on the same delivery table the dispatcher drains, and the service takes the gate.
  let webhookEndpoints: WebhookEndpointRepository | undefined;
  let webhookDeliveries: WebhookDeliveryRepository | undefined;
  if (config.webhooksEnabled) {
    webhookEndpoints = new DrizzleWebhookEndpointRepository(
      handle.db,
      config.webhookSecretEncryptionKey === undefined
        ? undefined
        : new SecretBox(config.webhookSecretEncryptionKey, config.webhookSecretPreviousKeys),
    );
    webhookDeliveries = new DrizzleWebhookDeliveryRepository(handle.db);
  }

  const riskAssessments = new DrizzleRiskAssessments(handle.db);
  const denylist = new DrizzleDenylist(handle.db);
  const riskGate = new RiskGateService({
    assessor: new RiskAssessor({
      rules: () => market.riskRules(),
      history: new DrizzleRiskHistory(handle.db),
      denylist,
      clock,
    }),
    assessments: riskAssessments,
    ...(webhookEndpoints === undefined || webhookDeliveries === undefined
      ? {}
      : { webhooks: { endpoints: webhookEndpoints, deliveries: webhookDeliveries } }),
    clock,
  });

  const intentRepository = new DrizzlePaymentIntentRepository(handle.db);
  const intents = new PaymentIntentService({
    repository: intentRepository,
    clock,
    events,
    registry,
    // A merchant's own settlement asset outranks `config.settlementAsset`,
    // which stays as the fallback for a merchant that has not chosen one.
    merchantPolicies,
    // Buyer protection applies only where an escrow factory is deployed.
    escrowChains: ESCROW_CHAINS,
    // A wallet that keeps losing disputes is not offered protection (#314).
    payerStanding,
    // Fraud rules run when a payment is confirmed; only a block refuses it.
    riskGate,
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
  const subscriptions = new SubscriptionApiService({
    subscriptions: new DrizzleSubscriptionRepository(handle.db),
    customers: new DrizzleCustomerRepository(handle.db),
    invoices,
    clock,
  });

  const ledger = new LedgerService({
    repository: new DrizzleLedgerRepository(handle.db, clock),
    clock,
  });

  const adapters = new SettlementAdapterRegistry([
    // The mock adapter settles without moving value, and a caller may name a
    // provider per payment, so a mainnet deployment does not register it at all.
    ...(isMainnetDeployment(config)
      ? []
      : [
          new MockSettlementAdapter({
            clock,
            ...(config.mockWebhookSecret === undefined
              ? {}
              : { webhookSecret: config.mockWebhookSecret }),
          }),
        ]),
    // Backed by Postgres, not memory: the engine asks this adapter what became
    // of a settlement it already recorded, and that question outlives the
    // process that answered the first one.
    new StablecoinSettlementAdapter({
      clock,
      store: new DrizzleInternalSettlementStore(handle.db),
    }),
  ]);

  const fees = new BasisPointsFeePolicy(config.feeBasisPoints, config.feeMinimum);
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
    treasuryAddresses: [
      ...(config.treasuryAddress === undefined ? [] : [config.treasuryAddress]),
      ...Object.values(config.contract?.solana?.feeRecipients ?? {}).filter(
        (address): address is string => address !== undefined,
      ),
      ...(config.contract?.solana === undefined
        ? []
        : [solanaKeypairFromSecret(config.contract.solana.signerSecretKey).publicKey.toBase58()]),
    ],
  });

  const solanaRuntime =
    config.contract?.solana === undefined || chain === undefined
      ? undefined
      : {
          signer: new LocalSolanaOrderSigner(config.contract.solana.signerSecretKey),
          deploymentDomains: config.contract.solana.deploymentDomains,
          feeRecipients: config.contract.solana.feeRecipients,
          connections: Object.fromEntries(
            Object.entries(config.contract.solana.deploymentDomains).flatMap(([chainId]) => {
              const id = chainId as ChainId;
              const rpcUrl = chain.rpcUrls[id];
              return rpcUrl === undefined ? [] : [[id, createSolanaConnection(rpcUrl)]];
            }),
          ),
          routeSources: Object.fromEntries(
            Object.entries(config.contract.solana.orcaPools).flatMap(([chainId, pools]) =>
              pools === undefined || pools.length === 0
                ? []
                : [
                    [
                      chainId,
                      new OrcaSolanaRouteSource({
                        pools,
                        slippageBps: config.quoteSlippageBps,
                        addressLookupTables:
                          config.contract?.solana?.orcaLookupTables[chainId as ChainId] ?? [],
                      }),
                    ],
                  ],
            ),
          ),
        };

  const contractPlanner =
    config.contract !== undefined
      ? new ApiContractPlanner({
          contract: config.contract,
          quote: resolveQuote,
          fees,
          relayerGasFees,
          relayerGasFeeMinimums: config.relayerGasFeeMinimums,
          stablecoins: registry,
          merchantPolicies,
          wallets: walletGuard,
          // A merchant who never named their provisioned Safe is still paid at
          // it, rather than finding out at their first payment that a settings
          // field nobody mentioned was load-bearing.
          settlementAddresses,
          registry: rpcMerchantRegistry({
            rpcUrls: config.chainRpcUrls,
            routers: config.contract.paymentRouters,
            clock,
          }),
          ...(solanaRuntime === undefined
            ? {}
            : {
                solana: {
                  signer: solanaRuntime.signer,
                  deploymentDomains: solanaRuntime.deploymentDomains,
                },
              }),
          ...(config.escrowArbiter === undefined ? {} : { escrowArbiter: config.escrowArbiter }),
          clock,
        })
      : undefined;

  // Its own two connections for the outbox writes; see PostgresNonceSequencer.
  const outbox = createDatabase({ url: config.databaseUrl, maxConnections: 2 });
  const nonces = new PostgresNonceSequencer(handle.db, clock, outbox.db, fence);
  const operator = operatorAccount(config);
  const operatorFloat =
    operator === undefined || Object.keys(config.operatorFloatLimits).length === 0
      ? undefined
      : new OperatorFloatMonitor(
          rpcFloatReader({
            address: operator.address,
            rpcUrls: config.chainRpcUrls,
            nativeAssets: config.chainNativeAssets,
            tokens: tokensOf(config.stablecoins),
          }),
          config.operatorFloatLimits,
        );
  const operatorTransactions = new OperatorTransactionReconciler({
    store: new DrizzleOperatorTransactionStore(handle.db),
    chain: rpcOperatorChainReader(config.chainRpcUrls),
    clock,
    ...(operator === undefined ? {} : { bumper: rpcOperatorBumper(operator, config.chainRpcUrls) }),
  });

  const treasury = createTreasuryExecutor({
    config,
    nonces,
    ledger,
    depositAddresses,
    solanaRuntime,
    uniswapPools: async () => (await market.uniswapPools()) as Config["uniswapPools"],
    settlements: new DrizzleSettlementEventRepository(handle.db),
  });
  const treasuryExecutor = treasury?.executor;

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
    maxPaymentSettlement: minorLimits(config.maxPaymentSettlement),
    maxMerchantDailySettlement: minorLimits(config.maxMerchantDailySettlement),
    ...(depositAddresses === undefined ? {} : { depositAddresses }),
    ...(depositDeriver === undefined ? {} : { depositDeriver }),
    ...(contractPlanner === undefined ? {} : { contractPlanner }),
    ...(treasuryExecutor === undefined ? {} : { treasuryExecutor }),
    ...(treasury === undefined
      ? {}
      : {
          treasuryExecutionChains: treasury.chains,
        }),
    treasuryAddresses: Object.fromEntries([
      ...Object.keys(config.depositForwarders)
        .filter(isEvmChainId)
        .flatMap((chain) =>
          config.treasuryAddress === undefined ? [] : [[chain, config.treasuryAddress]],
        ),
      ...Object.keys(solanaRuntime?.connections ?? {}).map((chain) => [
        chain,
        solanaRuntime?.signer.publicKey() ?? "",
      ]),
    ]),
  });

  const checkout =
    config.contract === undefined
      ? undefined
      : new ContractCheckout({
          engine,
          intents,
          contract: config.contract,
          stablecoins: registry,
          routeSources: async () =>
            createRouteSources(config, (await market.uniswapPools()) as Config["uniswapPools"]),
          clock,
          ...(solanaRuntime === undefined
            ? {}
            : {
                solana: {
                  connections: solanaRuntime.connections,
                  deploymentDomains: solanaRuntime.deploymentDomains,
                  feeRecipients: solanaRuntime.feeRecipients,
                  routeSources: solanaRuntime.routeSources,
                },
              }),
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
      logRanges: chain.logRanges,
    });
    const cursors = new DrizzleWatcherCursorRepository(handle.db);
    const chainClients = new Map<ChainId, ChainClient>();
    for (const id of EVM_CHAINS) chainClients.set(id, client);

    // The watcher speaks to the engine through a sink rather than importing it:
    // `@mayarin/chain` must not depend on `@mayarin/clearing`.
    const sink = {
      fund: async (clearingTransactionId: string) => {
        await engine.recordAssetReceived(clearingTransactionId);
      },
    };

    for (const chainId of new Set(
      pairsOf(config.stablecoins)
        .map((pair) => pair.chain)
        .filter(isEvmChainId),
    )) {
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
          maxStartBacklogBlocks: chain.maxStartBacklogBlocks,
          // Which asset on this chain is the chain's own. Native balance
          // reconciliation is always on; token catch-up is an explicit option.
          nativeAssets: config.chainNativeAssets,
        }),
      );
    }

    for (const chainId of new Set(
      pairsOf(config.stablecoins)
        .map((pair) => pair.chain)
        .filter(isSolanaChainId),
    )) {
      const connection = solanaRuntime?.connections[chainId];
      if (connection === undefined) continue;
      const solanaClient = new SolanaDepositClient({
        connection,
        tokens: tokensOf(config.stablecoins)[chainId] ?? {},
        ...(config.chainNativeAssets[chainId] === undefined
          ? {}
          : { nativeAsset: config.chainNativeAssets[chainId] }),
      });
      chainClients.set(chainId, solanaClient);
      watchers.set(
        chainId,
        new WalletWatcher({
          client: solanaClient,
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
          // Not the EVM ranges: see SOLANA_SCAN_RANGE.
          blockRange: SOLANA_SCAN_RANGE,
          nativeBlockRange: SOLANA_SCAN_RANGE,
          tokenBalanceCatchUp: false,
          retentionSeconds: chain.retentionSeconds,
          startBlocks: chain.startBlocks,
          nativeAssets: config.chainNativeAssets,
        }),
      );
    }
    chainHead = async (id: ChainId) => {
      const selected = chainClients.get(id);
      if (selected === undefined)
        throw new ConfigurationError(`No chain client for ${id}`, { chain: id });
      return selected.head(id);
    };
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
      const id = routerChain as ChainId;
      const solanaConnection = solanaRuntime?.connections[id];
      const client =
        isSolanaChainId(id) && solanaConnection !== undefined
          ? new SolanaSettlementClient(solanaConnection)
          : indexerClient;
      indexers.set(
        id,
        new SettlementIndexer({
          client,
          settlements: settlementRepository,
          cursors: indexerCursors,
          sink: completionSink,
          clock,
          policy: {
            // The same finality line a deposit gets: a settlement below the
            // depth has told the engine nothing and can vanish freely.
            depth: chain.confirmations[id],
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
  if (webhookEndpoints !== undefined && webhookDeliveries !== undefined) {
    webhooks = new WebhookDispatcher({
      outbox: new DrizzleWebhookOutbox(handle.db),
      cursor: new DrizzleWebhookCursorRepository(handle.db),
      endpoints: webhookEndpoints,
      deliveries: webhookDeliveries,
      transport: new PinnedWebhookTransport(),
      clock,
    });
  }

  // A newly opened dispute is announced to the merchant (#313): a webhook on
  // the delivery table the dispatcher drains, and an email to its admins.
  const users = new DrizzleUserRepository(handle.db);
  const adminEmails = async (merchantId: string) =>
    (await users.listByMerchant(merchantId))
      .filter((user) => user.permissions.includes("admin:access"))
      .map((user) => user.email);
  const disputeNotices = disputeNotifier({
    ...(webhookEndpoints === undefined || webhookDeliveries === undefined
      ? {}
      : { webhooks: { endpoints: webhookEndpoints, deliveries: webhookDeliveries } }),
    ...(config.resendApiKey === undefined
      ? {}
      : {
          email: {
            apiKey: config.resendApiKey,
            from: config.emailFrom,
            recipients: adminEmails,
            ...(config.dashboardUrl === undefined ? {} : { dashboardUrl: config.dashboardUrl }),
          },
        }),
    clock,
  });

  // "You got paid": its own cursor on the clearing log, plus the
  // keeper's undisputed releases. Email only, so nothing without Resend.
  const paidNotices =
    config.resendApiKey === undefined
      ? undefined
      : new PaidNotifier({
          outbox: new DrizzleWebhookOutbox(handle.db),
          cursor: new DrizzleWebhookCursorRepository(handle.db, "paid-email"),
          transactions: clearingRepository,
          email: {
            apiKey: config.resendApiKey,
            from: config.emailFrom,
            recipients: adminEmails,
            ...(config.dashboardUrl === undefined ? {} : { dashboardUrl: config.dashboardUrl }),
          },
          clock,
        });

  // Built after the watchers, because a rail is only real when something is
  // scanning the chain it is on.
  const evmContractCode =
    Object.keys(config.chainRpcUrls).length === 0
      ? undefined
      : new EvmContractCodeReader({ rpcUrls: config.chainRpcUrls });
  const railPricing = new QuotePricingSource({ market, rates, config });
  const railReceipts = chainReceipts(
    config,
    new Set<ChainId>([...watchers.keys(), ...indexers.keys()]),
  );
  const railCatalog = new DerivedRailCatalog({
    receipts: railReceipts,
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
          settlementRequiredChains:
            config.executionPath === "on-chain-contract"
              ? new Set(Object.keys(config.contract?.paymentRouters ?? {}) as ChainId[])
              : (treasury?.chains ?? new Set<ChainId>()),
        }),
    pricing: railPricing,
    defaultSettlementAsset: config.settlementAsset,
    // Absent with no RPC configured: a deployment settling off-chain cannot
    // strand funds at a contract address that does not exist on a chain.
    ...(evmContractCode === undefined
      ? {}
      : {
          code: {
            hasCode: (railChain: ChainId, address: string) =>
              isEvmChainId(railChain)
                ? evmContractCode.hasCode(railChain, address)
                : Promise.resolve(false),
          },
        }),
  });

  const payableQuotes = new DrizzlePayableQuoteRepository(handle.db);

  const x402 = createX402({
    config,
    nonces,
    handle,
    rates,
    intents,
    engine,
    merchants,
    merchantPolicies,
    settlementAddresses,
    quote: config.quote === undefined ? undefined : resolveQuote,
    merchantRails: railCatalog,
    payableQuotes,
    uniswapPools: async () => (await market.uniswapPools()) as Config["uniswapPools"],
    clock,
  });

  // The commerce side of the x402 rail (#273). Built from the same quote rows
  // the service settles through, and absent with the rail itself.
  const x402Payables =
    x402 === undefined
      ? undefined
      : new X402PayableService({
          x402,
          quotes: payableQuotes,
          invoices,
          links: catalog,
          clock,
          quoteTtlSeconds: config.x402QuoteTtlSeconds,
        });
  const escrowTreasuryPort = treasury?.evmPort;
  const gasRefiller =
    escrowTreasuryPort === undefined ||
    operator === undefined ||
    config.treasuryAddress === undefined ||
    Object.keys(config.gasRefill).length === 0
      ? undefined
      : new GasRefiller({
          chains: config.gasRefill as ConstructorParameters<typeof GasRefiller>[0]["chains"],
          port: rpcGasRefillPort({
            rpcUrls: config.chainRpcUrls,
            send: (chain, to, data) => escrowTreasuryPort.call(chain, to, data),
          }),
          tokens: tokensOf(config.stablecoins),
          safe: getAddress(config.treasuryAddress),
          operator: operator.address,
          route: lifiGasRoute({
            ...(config.lifiApiKey === undefined ? {} : { apiKey: config.lifiApiKey }),
          }),
        });

  return {
    config,
    verifyApiKey: createApiKeyVerifier({ keys: new DrizzleApiKeyRepository(handle.db), clock }),
    payerTokens: new PayerTokens({
      key: config.payerTokenKey ?? randomBytes(32).toString("hex"),
      ttlSeconds: config.payerTokenTtlSeconds,
      clock,
    }),
    intents,
    catalog,
    commerce,
    invoices,
    subscriptions,
    ledger,
    engine,
    rates,
    paymentApp,
    analytics: new AnalyticsService({
      intents: intentRepository,
      clearing: clearingRepository,
      clock,
    }),
    escrow: new EscrowService(paymentApp, config.chainRpcUrls, disputes, clock, disputeNotices),
    payerStanding,
    riskAssessments,
    denylist,
    ...(transfi === undefined ? {} : { transfi }),
    paymentFundings,
    clock,
    adminAudit: new DrizzleAdminAuditRepository(handle.db),
    ...(transfi === undefined || !config.transfiSandboxAutoSettle
      ? {}
      : {
          fiatSettler: new FiatSettler({
            fundings: paymentFundings,
            transfi,
            payments: paymentApp,
            engine,
            fund:
              escrowTreasuryPort === undefined
                ? undefined
                : async (deposit) => {
                    const chain = deposit.chain as ChainId;
                    const token = config.chainAssets[chain]?.[deposit.asset as AssetCode];
                    if (token === undefined) {
                      throw new ConfigurationError(
                        `No ${deposit.asset} token address for ${deposit.chain}; cannot fund the deposit address`,
                        { chain: deposit.chain, asset: deposit.asset },
                      );
                    }
                    await escrowTreasuryPort.call(
                      chain,
                      token,
                      encodeFunctionData({
                        abi: parseAbi(["function transfer(address to, uint256 amount)"]),
                        functionName: "transfer",
                        args: [deposit.address as `0x${string}`, deposit.amount.amount],
                      }),
                    );
                  },
            clock,
          }),
        }),
    ...(escrowTreasuryPort === undefined
      ? {}
      : {
          escrowKeeper: new EscrowKeeper({
            repository: clearingRepository,
            read: rpcEscrowStateReader(config.chainRpcUrls),
            send: (chain, to, data) => escrowTreasuryPort.call(chain, to, data),
            disputes,
            alert: disputeAlertSink(config.escrowAlertWebhookUrl),
            notifier: disputeNotices,
            ...(paidNotices === undefined ? {} : { paid: paidNotices }),
            clock,
          }),
        }),
    ...(paidNotices === undefined ? {} : { paidNotices }),
    refunds,
    operatorTransactions,
    ...(operatorFloat === undefined ? {} : { operatorFloat }),
    ...(gasRefiller === undefined ? {} : { gasRefiller }),
    ...(stream === undefined ? {} : { stream }),
    adapters,
    events,
    registry,
    market,
    merchantPolicies,
    merchants,
    rails: railCatalog,
    warmRailPricing: () => {
      const settlements = new Set<AssetCode>([
        config.settlementAsset,
        ...config.settlementAssets.filter(isAssetCode),
      ]);
      const pairs = railReceipts.flatMap((receipt) =>
        [
          ...new Set([
            ...(Object.keys(receipt.tokens) as AssetCode[]),
            ...(receipt.nativeAsset === undefined ? [] : [receipt.nativeAsset]),
          ]),
        ].flatMap((asset) =>
          [...settlements].map((settlementAsset) => ({
            chain: receipt.chain,
            asset,
            settlementAsset,
          })),
        ),
      );
      return railPricing.warm(pairs);
    },
    walletGuard,
    watchers,
    indexers,
    ...(deposits === undefined ? {} : { deposits }),
    ...(deposits === undefined || chain === undefined
      ? {}
      : {
          lateDeposits: new LateDepositService({
            engine,
            deposits,
            clock,
            windowMs: chain.retentionSeconds * 1_000,
          }),
        }),
    ...(chainHead === undefined ? {} : { chainHead }),
    ...(checkout === undefined ? {} : { checkout }),
    ...(webhooks === undefined ? {} : { webhooks }),
    ...(webhookEndpoints === undefined ? {} : { webhookEndpoints }),
    ...(webhookDeliveries === undefined ? {} : { webhookDeliveries }),
    ...(x402 === undefined ? {} : { x402 }),
    ...(x402Payables === undefined ? {} : { x402Payables }),
    close: async () => {
      await outbox.close();
      await handle.close();
    },
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
