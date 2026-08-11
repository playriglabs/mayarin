/**
 * API test harness.
 *
 * Builds the same `Container` the production composition root builds, but on
 * in-memory repositories — so route tests exercise real services and the real
 * clearing engine without a database.
 */

import { CatalogService, CheckoutService } from "@mayarin/catalog";
import { InMemoryPaymentLinkRepository, InMemoryProductRepository } from "@mayarin/catalog/testing";
import {
  BasisPointsFeePolicy,
  ClearingEngine,
  LiquidityRouter,
  RefundService,
  TablePriceSource,
} from "@mayarin/clearing";
import { InMemoryClearingRepository, InMemoryRefundRepository } from "@mayarin/clearing/testing";
import { InvoiceService } from "@mayarin/invoicing";
import { InMemoryInvoiceRepository } from "@mayarin/invoicing/testing";
import { LedgerService } from "@mayarin/ledger";
import { InMemoryLedgerRepository } from "@mayarin/ledger/testing";
import { type MerchantAssetPolicySource, PaymentIntentService } from "@mayarin/payment-intent";
import { InMemoryPaymentIntentRepository } from "@mayarin/payment-intent/testing";
import { type MockBehaviour, MockSettlementAdapter } from "@mayarin/provider-mock";
import { StablecoinSettlementAdapter } from "@mayarin/provider-stablecoin";
import { SettlementAdapterRegistry } from "@mayarin/settlement";
import { FixedClock, InMemoryEventBus } from "@mayarin/shared";
import { InMemoryMarketConfigStore } from "@mayarin/shared/testing";
import { InMemoryStablecoinRegistry } from "@mayarin/stablecoin";
import { WalletGuard } from "@mayarin/wallet";
import { InMemoryMerchantWalletRepository } from "@mayarin/wallet/testing";
import { createApp } from "../src/app.ts";
import { type Config, loadConfig } from "../src/config.ts";
import type { Container } from "../src/container.ts";
import { RuntimeMarket } from "../src/market.ts";
import { PaymentAppService } from "../src/services/payment.ts";
import { PaymentStream } from "../src/services/payment-stream.ts";

export const WEBHOOK_SECRET = "whsec_mayarin_test";

export interface ApiHarnessOptions {
  readonly behaviour?: MockBehaviour;
  readonly assetReceiptMode?: Config["assetReceiptMode"];
  readonly adminToken?: string;
}

export function createApiHarness(options: ApiHarnessOptions = {}) {
  const clock = new FixedClock("2026-01-01T00:00:00.000Z");
  const events = new InMemoryEventBus();

  const config: Config = loadConfig({
    PORT: "3000",
    DATABASE_URL: "memory://",
    SETTLEMENT_ASSET: "IDRX",
    FEE_BASIS_POINTS: "50",
    DEFAULT_SETTLEMENT_PROVIDER: "mock",
    PAYMENT_INTENT_TTL_SECONDS: "900",
    ASSET_RECEIPT_MODE: options.assetReceiptMode ?? "auto",
    EXCHANGE_RATES: '{"IDR/IDRX":"100"}',
    // Admit USDC on base-sepolia so payment-rail route tests can use it; the
    // chain layer itself stays off (CHAIN_ENABLED unset).
    CHAIN_ASSETS: '{"base-sepolia":{"USDC":"0x036CbD53842c5426634e7929541eC2318f3dCF7e"}}',
    MOCK_WEBHOOK_SECRET: WEBHOOK_SECRET,
    ...(options.adminToken === undefined ? {} : { ADMIN_TOKEN: options.adminToken }),
  });

  const adapter = new MockSettlementAdapter({
    clock,
    behaviour: options.behaviour ?? "succeed",
    webhookSecret: WEBHOOK_SECRET,
  });
  const adapters = new SettlementAdapterRegistry([
    adapter,
    new StablecoinSettlementAdapter({ clock }),
  ]);
  const registry = new InMemoryStablecoinRegistry(config.stablecoins);

  const intentRepository = new InMemoryPaymentIntentRepository();
  const intents = new PaymentIntentService({
    repository: intentRepository,
    clock,
    events,
    registry,
    defaults: {
      settlementAsset: config.settlementAsset,
      provider: config.defaultProvider,
      executionPath: config.executionPath,
      ttlSeconds: config.paymentIntentTtlSeconds,
    },
  });

  const ledger = new LedgerService({
    repository: new InMemoryLedgerRepository(clock),
    clock,
  });

  const clearingRepository = new InMemoryClearingRepository();
  const refundRepository = new InMemoryRefundRepository();

  // One provider for the engine and the quote route: a preview priced from a
  // different source than the lock would show a payer one number and charge
  // them another.
  const rates = new LiquidityRouter({ source: new TablePriceSource(config.exchangeRates) });

  const engine = new ClearingEngine({
    repository: clearingRepository,
    intents,
    ledger,
    adapters,
    rates,
    fees: new BasisPointsFeePolicy(config.feeBasisPoints),
    clock,
    events,
    autoConfirmAssetReceipt: config.assetReceiptMode === "auto",
  });

  const products = new InMemoryProductRepository();
  const links = new InMemoryPaymentLinkRepository();
  const commerce = new CheckoutService({ products, links, intents, clock });
  // Market config over an in-memory store: the harness exercises the same
  // runtime path production takes, seeded from the same environment values.
  const marketStore = new InMemoryMarketConfigStore();
  const market = new RuntimeMarket({ store: marketStore, config, clock, cacheMs: 0 });

  // A stream driven by hand rather than by Postgres: the harness has no
  // database, and what route tests assert is the fan-out, not the transport.
  let notify: ((paymentIntentId: string) => void) | undefined;
  const stream = new PaymentStream({
    subscribe: async (onChange) => {
      notify = onChange;
      return {
        unlisten: async () => {
          notify = undefined;
        },
      };
    },
  });

  // No merchant records in the harness, so every merchant reads as "no policy"
  // — which is the state the routes must handle anyway: the deployment default
  // stands and the checkout offers what this deployment can receive.
  const merchantPolicies: MerchantAssetPolicySource = { policyFor: async () => undefined };

  const container: Container = {
    config,
    intents,
    merchantPolicies,
    catalog: new CatalogService({ products, links, clock }),
    commerce,
    invoices: new InvoiceService({
      invoices: new InMemoryInvoiceRepository(),
      checkout: commerce,
      payments: intentRepository,
      clock,
    }),
    ledger,
    engine,
    rates,
    paymentApp: new PaymentAppService({ intents, engine, ledger }),
    stream,
    refunds: new RefundService({
      clearing: clearingRepository,
      refunds: refundRepository,
      adapters,
      ledger,
      clock,
      events,
    }),
    adapters,
    events,
    registry,
    market,
    // No merchant wallets in the harness, so the guard has nothing to allow —
    // route tests here do not sign orders, and the ones that do live in
    // `contract-layer.test.ts` with their own guard.
    walletGuard: new WalletGuard({
      wallets: new InMemoryMerchantWalletRepository(),
      treasuryAddresses: [],
    }),
    watchers: new Map(),
    indexers: new Map(),
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

  /** A server-rendered page returns HTML, so `request` cannot parse it. */
  async function requestHtml(path: string) {
    const response = await app.request(path, { method: "GET" });
    return { status: response.status, text: await response.text() };
  }

  return {
    app,
    clock,
    adapter,
    container,
    request,
    requestHtml,
    ledger,
    engine,
    intents,
    market,
    marketStore,
    stream,
    /** Fires a change as Postgres would, once `stream.start()` has run. */
    notifyPayment: (paymentIntentId: string) => notify?.(paymentIntentId),
    refundRepository,
  };
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
    tlv("59", "Warung Kopi Mayarin"),
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
