/**
 * Composition root.
 *
 * The only file that knows which concrete adapters this deployment runs. Every
 * package below it depends on ports, which is what keeps providers and storage
 * swappable.
 */

import { type BlockRef, type ChainId, WalletWatcher } from "@mayarin/chain";
import {
  BasisPointsFeePolicy,
  ClearingEngine,
  LiquidityRouter,
  TablePriceSource,
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
  DrizzleWatcherCursorRepository,
} from "@mayarin/db";
import { LedgerService } from "@mayarin/ledger";
import { PaymentIntentService } from "@mayarin/payment-intent";
import { EvmChainClient, HdDepositAddressDeriver } from "@mayarin/provider-evm";
import { MockSettlementAdapter } from "@mayarin/provider-mock";
import { StablecoinSettlementAdapter } from "@mayarin/provider-stablecoin";
import { SettlementAdapterRegistry } from "@mayarin/settlement";
import {
  type AssetCode,
  type Clock,
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
  close(): Promise<void>;
}

export interface CreateContainerOptions {
  readonly config: Config;
  readonly clock?: Clock;
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
  const depositDeriver =
    chain === undefined ? undefined : new HdDepositAddressDeriver({ xpub: chain.xpub });

  const intents = new PaymentIntentService({
    repository: new DrizzlePaymentIntentRepository(handle.db),
    clock,
    events,
    registry,
    // A merchant's own settlement asset outranks `config.settlementAsset`,
    // which stays as the fallback for a merchant that has not chosen one.
    merchantPolicies: new DrizzleMerchantAssetPolicySource(
      new DrizzleMerchantRepository(handle.db),
    ),
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
          clock,
        })
      : undefined;

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
