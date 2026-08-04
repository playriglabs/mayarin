/**
 * Test harness: a fully wired clearing stack backed by in-memory repositories.
 *
 * Mirrors the composition the API performs, so engine tests exercise the real
 * collaboration between intents, ledger, adapters and clearing.
 */

import {
  FixedDepositAddressDeriver,
  InMemoryDepositAddressRepository,
} from "@mayarin/chain/testing";
import { type AccountKind, LedgerService } from "@mayarin/ledger";
import { InMemoryLedgerRepository } from "@mayarin/ledger/testing";
import { PaymentIntentService, type PaymentRail } from "@mayarin/payment-intent";
import { InMemoryPaymentIntentRepository } from "@mayarin/payment-intent/testing";
import { type MockBehaviour, MockSettlementAdapter } from "@mayarin/provider-mock";
import { SettlementAdapterRegistry, type SettlementMode } from "@mayarin/settlement";
import { type DomainEvent, FixedClock, InMemoryEventBus, money } from "@mayarin/shared";
import { ClearingEngine } from "../src/engine.ts";
import { BasisPointsFeePolicy } from "../src/fees.ts";
import { StaticRateProvider } from "../src/rate.ts";
import { InMemoryClearingRepository } from "../testing/index.ts";

export const NOW = "2026-01-01T00:00:00.000Z";

export interface HarnessOptions {
  readonly behaviour?: MockBehaviour;
  readonly feeBasisPoints?: number;
  readonly autoConfirmAssetReceipt?: boolean;
  readonly webhookSecret?: string;
  /** Settlement mode for the mock adapter. Defaults to `"external"`. */
  readonly mode?: SettlementMode;
  /** IDR -> IDRX at 1:1 by default; both are 2-decimal. */
  readonly rates?: Readonly<Record<string, bigint>>;
}

export function createHarness(options: HarnessOptions = {}) {
  const clock = new FixedClock(NOW);
  const intentRepository = new InMemoryPaymentIntentRepository();
  const ledgerRepository = new InMemoryLedgerRepository(clock);
  const clearingRepository = new InMemoryClearingRepository();

  const published: DomainEvent[] = [];
  const events = new InMemoryEventBus();
  events.subscribe("*", (event) => {
    published.push(event);
  });

  const adapter = new MockSettlementAdapter({
    clock,
    behaviour: options.behaviour ?? "succeed",
    ...(options.mode === undefined ? {} : { mode: options.mode }),
    ...(options.webhookSecret === undefined ? {} : { webhookSecret: options.webhookSecret }),
  });

  const intents = new PaymentIntentService({
    repository: intentRepository,
    clock,
    events,
    defaults: {
      settlementAsset: "IDRX",
      provider: "mock",
      executionPath: "deposit-match",
      ttlSeconds: 900,
    },
  });

  const ledger = new LedgerService({ repository: ledgerRepository, clock });

  const depositAddresses = new InMemoryDepositAddressRepository();
  const depositDeriver = new FixedDepositAddressDeriver();

  const engine = new ClearingEngine({
    repository: clearingRepository,
    intents,
    ledger,
    adapters: new SettlementAdapterRegistry([adapter]),
    rates: new StaticRateProvider(options.rates ?? { "IDR/IDRX": 100n }),
    fees: new BasisPointsFeePolicy(options.feeBasisPoints ?? 50),
    depositAddresses,
    depositDeriver,
    clock,
    events,
    autoConfirmAssetReceipt: options.autoConfirmAssetReceipt ?? true,
  });

  /** Creates and confirms an intent for 50,000.00 IDR, ready to clear. */
  async function confirmedIntent(
    overrides: { idempotencyKey?: string; payment?: PaymentRail } = {},
  ) {
    const created = await intents.create({
      merchant: {
        id: "ID1020017611473",
        name: "Warung Kopi Mayarin",
        city: "Jakarta",
        countryCode: "ID",
      },
      amount: money(5_000_000n, "IDR"),
      source: { type: "manual" },
      ...overrides,
    });
    return intents.confirm(created.id);
  }

  async function balance(kind: AccountKind) {
    return (await ledger.balance(kind, "IDRX")).balance;
  }

  return {
    clock,
    adapter,
    intents,
    ledger,
    engine,
    published,
    repositories: {
      intents: intentRepository,
      ledger: ledgerRepository,
      clearing: clearingRepository,
      depositAddresses,
    },
    confirmedIntent,
    balance,
  };
}
