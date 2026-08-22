/**
 * Dashboard API test harness.
 *
 * Mirrors the production composition root on in-memory repositories, so route
 * tests exercise the real services and middleware without a database. A plain
 * password hasher keeps the suite fast — argon2's cost is verified in its own
 * package tests, not re-paid on every login here.
 *
 * Seeds one merchant (`mrc_…`) with a merchant-admin account so route tests have
 * a logged-in scope to work with. `merchantId` is exposed so tests can create
 * payment intents against the right tenant.
 */

import { MERCHANT_ADMIN_PERMISSIONS, type PasswordHasher } from "@mayarin/auth";
import {
  InMemoryApiKeyRepository,
  InMemoryMerchantAccountRepository,
  InMemoryMerchantRepository,
  InMemoryMerchantSettingChangeRepository,
  InMemorySessionRepository,
  InMemoryUserRepository,
} from "@mayarin/auth/testing";
import { CatalogService } from "@mayarin/catalog";
import {
  InMemoryCustomerRepository,
  InMemoryPaymentLinkRepository,
  InMemoryProductRepository,
} from "@mayarin/catalog/testing";
import {
  InMemoryDepositRepository,
  InMemorySettlementEventRepository,
} from "@mayarin/chain/testing";
import { InMemoryClearingRepository } from "@mayarin/clearing/testing";
import { ComplianceService } from "@mayarin/compliance";
import {
  InMemoryAuditQueryRepository,
  InMemoryMerchantEventRepository,
} from "@mayarin/compliance/testing";
import { LedgerService } from "@mayarin/ledger";
import { InMemoryLedgerRepository } from "@mayarin/ledger/testing";
import {
  InMemoryWebhookDeliveryRepository,
  InMemoryWebhookEndpointRepository,
} from "@mayarin/notifications/testing";
import { PaymentIntentService } from "@mayarin/payment-intent";
import { InMemoryPaymentIntentRepository } from "@mayarin/payment-intent/testing";
import { ViemSignatureVerifier } from "@mayarin/provider-evm";
import { FixedClock, InMemoryEventBus } from "@mayarin/shared";
import { ManagedWalletProvisioner, SettlementAddressResolver } from "@mayarin/wallet";
import {
  FakeMerchantKeyProvider,
  FakeWalletProvider,
  InMemoryMerchantWalletRepository,
  InMemoryWalletBalanceReader,
  InMemoryWalletChallengeRepository,
} from "@mayarin/wallet/testing";
import { createApp } from "../src/app.ts";
import { type Config, loadConfig } from "../src/config.ts";
import type { Container } from "../src/container.ts";
import { ApiKeyService } from "../src/services/api-key-service.ts";
import { AuthService } from "../src/services/auth-service.ts";
import { CustomerService } from "../src/services/customer-service.ts";
import { EventLogService } from "../src/services/event-log-service.ts";
import { MerchantCatalogService } from "../src/services/merchant-catalog-service.ts";
import { MerchantSettingsService } from "../src/services/merchant-settings-service.ts";
import { OrderReadService } from "../src/services/order-read-service.ts";
import { PaymentApiClient } from "../src/services/payment-api-client.ts";
import { PaymentReadService } from "../src/services/payment-read-service.ts";
import { SessionService } from "../src/services/session-service.ts";
import { SettlementReadService } from "../src/services/settlement-read-service.ts";
import { UserService } from "../src/services/user-service.ts";
import { WalletService } from "../src/services/wallet-service.ts";
import { WebhookService } from "../src/services/webhook-service.ts";

/**
 * The deployment's fee destination, exported so a test can try to claim it.
 * A merchant wallet that is also the fee recipient pays that merchant twice.
 */
export const TREASURY_ADDRESS = "0x00000000000000000000000000000000000feeee";

class PlainPasswordHasher implements PasswordHasher {
  async hash(plain: string): Promise<string> {
    return `plain:${plain}`;
  }
  async verify(plain: string, hashed: string): Promise<boolean> {
    return hashed === `plain:${plain}`;
  }
}

export interface DashboardHarnessOptions {
  readonly cookieSecure?: boolean;
  readonly rateLimitRequests?: number;
  readonly loginRateLimitRequests?: number;
  /** Email for the seeded merchant-admin account. */
  readonly adminEmail?: string;
  /** Password for the seeded merchant-admin account. */
  readonly adminPassword?: string;
  /** Display name for the seeded merchant. */
  readonly merchantName?: string;
}

export async function createDashboardHarness(options: DashboardHarnessOptions = {}) {
  const clock = new FixedClock("2026-01-01T00:00:00.000Z");

  const config: Config = loadConfig({
    DASHBOARD_API_PORT: "3001",
    DATABASE_URL: "memory://",
    SESSION_TTL_SECONDS: "3600",
    COOKIE_SECURE:
      options.cookieSecure === undefined ? "false" : options.cookieSecure ? "true" : "false",
    DASHBOARD_RATE_LIMIT_REQUESTS: String(options.rateLimitRequests ?? 120),
    DASHBOARD_LOGIN_RATE_LIMIT_REQUESTS: String(options.loginRateLimitRequests ?? 5),
    PAYMENTS_PAGE_SIZE: "7",
  });

  const users = new InMemoryUserRepository();
  const merchants = new InMemoryMerchantRepository();
  const accounts = new InMemoryMerchantAccountRepository(merchants, users);
  const sessions = new InMemorySessionRepository();
  const intents = new InMemoryPaymentIntentRepository();
  const clearing = new InMemoryClearingRepository();
  const hasher = new PlainPasswordHasher();
  const events = new InMemoryEventBus();

  // A payment-intent service over the same in-memory repo, so tests can create
  // real intents scoped to a merchant without building a registry by hand.
  const intentService = new PaymentIntentService({
    repository: intents,
    clock,
    events,
    defaults: {
      settlementAsset: "IDRX",
      provider: "mock",
      executionPath: "deposit-match",
      ttlSeconds: 900,
    },
  });

  const sessionService = new SessionService({
    sessions,
    users,
    clock,
    ttlSeconds: config.sessionTtlSeconds,
  });
  const authService = new AuthService({ users, hasher, sessions: sessionService });
  const userService = new UserService({ users, accounts, hasher, clock });
  const payments = new PaymentReadService({
    intents,
    clearing,
    pageSize: config.paymentsPageSize,
    clock,
  });

  // The compliance read stack, on the same in-memory repos the rest of the
  // harness uses — `audits` is fed clearing transactions directly, since the
  // real adapter projects the audit listing off exactly that table.
  const audits = new InMemoryAuditQueryRepository();
  const ledger = new InMemoryLedgerRepository(clock);
  const deposits = new InMemoryDepositRepository();
  const settlements = new InMemorySettlementEventRepository();
  const compliance = new ComplianceService({
    audits,
    clearing,
    ledger,
    intents,
    deposits,
    settlements,
  });
  // Tests post in business terms (a draft), so they need the service, not the
  // repository — `LedgerRepository.post` takes an already-built transaction.
  const ledgerService = new LedgerService({ repository: ledger, clock });

  const webhookEndpoints = new InMemoryWebhookEndpointRepository();
  const webhookDeliveries = new InMemoryWebhookDeliveryRepository();
  const webhooks = new WebhookService({
    endpoints: webhookEndpoints,
    deliveries: webhookDeliveries,
    clock,
    // A fixed public address: the suite asserts the policy, not the resolver,
    // and a registration test that needs DNS is one that fails on a plane.
    resolver: async () => ["93.184.216.34"],
  });

  const merchantWallets = new InMemoryMerchantWalletRepository();
  const walletChallenges = new InMemoryWalletChallengeRepository();
  // Managed provisioning against the reference fake provider. Deploying a real
  // Safe is proven on testnet; what the route tests are for is the surface
  // around it — scoping, idempotence, and that the two wallet paths coexist.
  const walletProvider = new FakeWalletProvider();
  const merchantKeyProvider = new FakeMerchantKeyProvider();
  const treasuryAddresses = [TREASURY_ADDRESS];
  const walletBalances = new InMemoryWalletBalanceReader();
  const wallets = new WalletService({
    wallets: merchantWallets,
    challenges: walletChallenges,
    // Real recovery: the point of verification is that it agrees with what a
    // wallet actually produces, which a stub cannot demonstrate.
    verifier: new ViemSignatureVerifier(),
    clock,
    treasuryAddresses,
    merchants,
    chain: "base-sepolia",
    settlementAddresses: new SettlementAddressResolver({ wallets: merchantWallets }),
    balances: walletBalances,
    walletProvider,
    nativeAsset: "ETH",
    keyProvider: merchantKeyProvider,
    provisioner: new ManagedWalletProvisioner({
      wallets: merchantWallets,
      provider: walletProvider,
      clock,
      treasuryAddresses,
    }),
  });

  const settingChanges = new InMemoryMerchantSettingChangeRepository();
  const settings = new MerchantSettingsService({ merchants, changes: settingChanges, clock });

  const products = new InMemoryProductRepository();
  const paymentLinks = new InMemoryPaymentLinkRepository();
  const catalog = new MerchantCatalogService({
    catalog: new CatalogService({ products, links: paymentLinks, clock }),
    settings,
    products,
  });

  // The merchant's customer directory + the commerce view of their payments.
  // Same shape as the production composition root: orders reads the customer
  // repo to resolve `metadata.customerId`, customers reads orders back for a
  // customer's linked orders and lifetime value.
  const customerRepository = new InMemoryCustomerRepository();
  const orders = new OrderReadService({
    intents,
    customers: customerRepository,
    pageSize: config.paymentsPageSize,
    clock,
  });
  const customers = new CustomerService({
    customers: customerRepository,
    orders,
    clock,
    pageSize: config.paymentsPageSize,
  });

  // Merchant API keys. The system generator/hashers are fine here: a test
  // creates a key through the route and uses the one-time secret it gets back,
  // so deterministic values are not needed.
  const apiKeyRepository = new InMemoryApiKeyRepository();
  const apiKeys = new ApiKeyService({ keys: apiKeyRepository, clock });

  const eventLogRepository = new InMemoryMerchantEventRepository();
  const eventLogs = new EventLogService({ events: eventLogRepository });

  /**
   * A payment API that answers without a network.
   *
   * Wired through the real `PaymentApiClient` rather than replaced by a stub,
   * so route tests exercise the request shapes and the error mapping the client
   * actually performs — the parts that would otherwise only be proven by a
   * running server. `paymentApiCalls` records what was asked, which is how a
   * test asserts that a counter sale pins the deposit path.
   */
  const paymentApiCalls: { path: string; body: unknown }[] = [];
  let mintedPaymentId = "pi_counter_00000000000000000";
  let confirmStatus = "PROCESSING";
  let confirmFailure: string | undefined;
  const paymentApi = new PaymentApiClient({
    baseUrl: "http://payment-api.test",
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
      paymentApiCalls.push({ path: url.pathname, body });

      const json = (value: unknown, status = 200) =>
        new Response(JSON.stringify(value), {
          status,
          headers: { "content-type": "application/json" },
        });

      if (url.pathname.endsWith("/checkout")) {
        return json({ paymentIntent: { id: mintedPaymentId } }, 201);
      }
      if (url.pathname.endsWith("/confirm")) {
        return json({
          paymentIntent: {
            id: mintedPaymentId,
            status: confirmStatus,
            ...(confirmFailure === undefined ? {} : { failureReason: confirmFailure }),
          },
        });
      }
      if (url.pathname === "/v1/quotes") {
        return json({
          source: { display: "Rp 75.000,00" },
          quotes: [
            { asset: "USDC", amount: { amount: "5020000", display: "5.02 USDC" }, available: true },
            {
              asset: "ETH",
              amount: null,
              available: false,
              reason: "No Pyth feed configured for IDR -> ETH",
            },
          ],
          indicative: true,
        });
      }
      if (url.pathname.startsWith("/v1/payments/")) {
        return json({
          deposit: {
            address: "0x00000000000000000000000000000000000dead0",
            chain: "base-sepolia",
            asset: "USDC",
            amount: { amount: "5020000", display: "5.02 USDC", formatted: "5.020000" },
            uri: "ethereum:0xtoken@84532/transfer?address=0xdead&uint256=5020000",
            received: { amount: "0", display: "0.00 USDC" },
            required: 1,
          },
        });
      }
      return json({ error: { message: `unexpected ${url.pathname}` } }, 404);
    }) as typeof fetch,
  });

  const settlementView = new SettlementReadService({
    payments,
    clearing,
    settlements,
  });

  const container: Container = {
    config,
    auth: authService,
    sessions: sessionService,
    users: userService,
    payments,
    compliance,
    settings,
    catalog,
    customers,
    orders,
    apiKeys,
    settlements: settlementView,
    eventLogs,
    paymentApi,
    webhooks,
    wallets,
    settlementAddresses: new SettlementAddressResolver({ wallets: merchantWallets }),
    close: async () => {},
  };

  const app = createApp(container);

  // Seed a merchant + its merchant-admin account (synchronously before tests).
  // `createMerchantAccount` uses the FixedClock, so ids are deterministic.
  const adminEmail = options.adminEmail ?? "admin@mayarin.local";
  const adminPassword = options.adminPassword ?? "test-password-12345";
  const seed = await userService.createMerchantAccount({
    email: adminEmail,
    password: adminPassword,
    merchantName: options.merchantName ?? "Acme",
    settlementAsset: "USDC",
    acceptedAssets: ["ETH", "USDC"],
    city: "Jakarta",
    countryCode: "ID",
    permissions: MERCHANT_ADMIN_PERMISSIONS,
  });
  const merchantId = seed.user.merchantId;

  async function request(
    method: string,
    path: string,
    init: {
      body?: unknown;
      headers?: Record<string, string>;
      cookies?: Record<string, string>;
    } = {},
  ) {
    const cookieHeader =
      init.cookies === undefined
        ? init.headers?.cookie
        : Object.entries(init.cookies)
            .map(([k, v]) => `${k}=${v}`)
            .join("; ");
    const response = await app.request(path, {
      method,
      headers: {
        "content-type": "application/json",
        ...init.headers,
        ...(cookieHeader === undefined ? {} : { cookie: cookieHeader }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    const setCookies = response.headers.getSetCookie();
    return {
      status: response.status,
      body: (await response.json().catch(() => null)) as Record<string, any> | null,
      setCookies,
    };
  }

  return {
    app,
    container,
    users,
    merchants,
    products,
    paymentLinks,
    customerRepository,
    apiKeyRepository,
    eventLogRepository,
    paymentApiCalls,
    /** Lets a test name the payment id the fake mints. */
    setMintedPaymentId: (id: string) => {
      mintedPaymentId = id;
    },
    /** Makes the fake answer confirm with a payment that failed to price. */
    failNextConfirm: (reason: string) => {
      confirmStatus = "FAILED";
      confirmFailure = reason;
    },
    settingChanges,
    webhookEndpoints,
    webhookDeliveries,
    merchantWallets,
    walletChallenges,
    walletProvider,
    walletBalances,
    merchantKeyProvider,
    sessions,
    intents,
    intentService,
    clearing,
    audits,
    ledger,
    ledgerService,
    deposits,
    settlements,
    hasher,
    clock,
    merchantId,
    adminEmail,
    adminPassword,
    request,
  };
}

/** Parses a `Set-Cookie` line into the cookie name and its attributes. */
export function parseSetCookie(line: string): { name: string; value: string; attrs: string } {
  const [pair, ...rest] = line.split(";");
  const [name, value] = (pair ?? "").split("=");
  return { name: (name ?? "").trim(), value: (value ?? "").trim(), attrs: rest.join(";") };
}

/** Builds a cookie map from a list of `Set-Cookie` lines (last value wins). */
export function cookieJar(lines: string[]): Record<string, string> {
  const jar: Record<string, string> = {};
  for (const line of lines) {
    const { name, value } = parseSetCookie(line);
    jar[name] = value;
  }
  return jar;
}
