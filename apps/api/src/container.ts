/**
 * Composition root.
 *
 * The only file that knows which concrete adapters this deployment runs. Every
 * package below it depends on ports, which is what keeps providers and storage
 * swappable.
 */

import { BasisPointsFeePolicy, ClearingEngine, StaticRateProvider } from "@mayarr/clearing";
import {
  createDatabase,
  type DatabaseHandle,
  DrizzleClearingRepository,
  DrizzleLedgerRepository,
  DrizzlePaymentIntentRepository,
} from "@mayarr/db";
import { LedgerService } from "@mayarr/ledger";
import { PaymentIntentService } from "@mayarr/payment-intent";
import { MockSettlementAdapter } from "@mayarr/provider-mock";
import { SettlementAdapterRegistry } from "@mayarr/settlement";
import { type Clock, type EventPublisher, InMemoryEventBus, systemClock } from "@mayarr/shared";
import type { Config } from "./config.ts";

export interface Container {
  readonly config: Config;
  readonly intents: PaymentIntentService;
  readonly ledger: LedgerService;
  readonly engine: ClearingEngine;
  readonly adapters: SettlementAdapterRegistry;
  readonly events: EventPublisher;
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

  const intents = new PaymentIntentService({
    repository: new DrizzlePaymentIntentRepository(handle.db),
    clock,
    events,
    defaults: {
      settlementAsset: config.settlementAsset,
      provider: config.defaultProvider,
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
  ]);

  const engine = new ClearingEngine({
    repository: new DrizzleClearingRepository(handle.db),
    intents,
    ledger,
    adapters,
    rates: new StaticRateProvider(config.exchangeRates),
    fees: new BasisPointsFeePolicy(config.feeBasisPoints),
    clock,
    events,
    autoConfirmAssetReceipt: config.assetReceiptMode === "auto",
  });

  return {
    config,
    intents,
    ledger,
    engine,
    adapters,
    events,
    close: () => handle.close(),
  };
}
