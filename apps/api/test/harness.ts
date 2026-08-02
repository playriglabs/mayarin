/**
 * API test harness.
 *
 * Builds the same `Container` the production composition root builds, but on
 * in-memory repositories — so route tests exercise real services and the real
 * clearing engine without a database.
 */

import { BasisPointsFeePolicy, ClearingEngine, StaticRateProvider } from "@mayarr/clearing";
import {
  InMemoryClearingRepository,
  InMemoryLedgerRepository,
  InMemoryPaymentIntentRepository,
} from "@mayarr/db/memory";
import { LedgerService } from "@mayarr/ledger";
import { PaymentIntentService } from "@mayarr/payment-intent";
import { type MockBehaviour, MockSettlementAdapter } from "@mayarr/provider-mock";
import { SettlementAdapterRegistry } from "@mayarr/settlement";
import { FixedClock, InMemoryEventBus } from "@mayarr/shared";
import { createApp } from "../src/app.ts";
import type { Config } from "../src/config.ts";
import type { Container } from "../src/container.ts";

export const WEBHOOK_SECRET = "whsec_mayarr_test";

export interface ApiHarnessOptions {
  readonly behaviour?: MockBehaviour;
  readonly assetReceiptMode?: Config["assetReceiptMode"];
}

export function createApiHarness(options: ApiHarnessOptions = {}) {
  const clock = new FixedClock("2026-01-01T00:00:00.000Z");
  const events = new InMemoryEventBus();

  const config: Config = {
    port: 0,
    databaseUrl: "memory://",
    settlementAsset: "IDRX",
    feeBasisPoints: 50,
    defaultProvider: "mock",
    paymentIntentTtlSeconds: 900,
    assetReceiptMode: options.assetReceiptMode ?? "auto",
    exchangeRates: { "IDR/IDRX": 100n },
    mockWebhookSecret: WEBHOOK_SECRET,
  };

  const adapter = new MockSettlementAdapter({
    clock,
    behaviour: options.behaviour ?? "succeed",
    webhookSecret: WEBHOOK_SECRET,
  });
  const adapters = new SettlementAdapterRegistry([adapter]);

  const intents = new PaymentIntentService({
    repository: new InMemoryPaymentIntentRepository(),
    clock,
    events,
    defaults: {
      settlementAsset: config.settlementAsset,
      provider: config.defaultProvider,
      ttlSeconds: config.paymentIntentTtlSeconds,
    },
  });

  const ledger = new LedgerService({
    repository: new InMemoryLedgerRepository(clock),
    clock,
  });

  const engine = new ClearingEngine({
    repository: new InMemoryClearingRepository(),
    intents,
    ledger,
    adapters,
    rates: new StaticRateProvider(config.exchangeRates),
    fees: new BasisPointsFeePolicy(config.feeBasisPoints),
    clock,
    events,
    autoConfirmAssetReceipt: config.assetReceiptMode === "auto",
  });

  const container: Container = {
    config,
    intents,
    ledger,
    engine,
    adapters,
    events,
    close: async () => {},
  };

  const app = createApp(container);

  async function request(
    method: string,
    path: string,
    init: { body?: unknown; headers?: Record<string, string> } = {},
  ) {
    const response = await app.request(path, {
      method,
      headers: {
        "content-type": "application/json",
        ...init.headers,
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  }

  return { app, clock, adapter, container, request, ledger, engine, intents };
}

/** Builds a valid dynamic QRIS payload for 50,000.00 IDR. */
export function qrisPayload(amount = "50000.00"): string {
  const tlv = (tag: string, value: string) =>
    `${tag}${value.length.toString().padStart(2, "0")}${value}`;

  const merchantAccount = [
    tlv("00", "ID.CO.QRIS.WWW"),
    tlv("01", "9360091812345678901"),
    tlv("02", "ID1020017611473"),
    tlv("03", "UMI"),
  ].join("");

  const base = [
    tlv("00", "01"),
    tlv("01", "12"),
    tlv("26", merchantAccount),
    tlv("52", "5411"),
    tlv("53", "360"),
    tlv("54", amount),
    tlv("58", "ID"),
    tlv("59", "Warung Kopi Mayarr"),
    tlv("60", "Jakarta"),
  ].join("");

  const withTag = `${base}6304`;
  let crc = 0xffff;
  for (let i = 0; i < withTag.length; i += 1) {
    crc ^= withTag.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }

  return `${withTag}${crc.toString(16).toUpperCase().padStart(4, "0")}`;
}
