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
  InMemoryEmailVerificationRepository,
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
import type { ChainId } from "@mayarin/chain";
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
import { InvoiceService } from "@mayarin/invoicing";
import { InMemoryInvoiceRepository } from "@mayarin/invoicing/testing";
import { LedgerService } from "@mayarin/ledger";
import { InMemoryLedgerRepository } from "@mayarin/ledger/testing";
import {
  InMemoryWebhookDeliveryRepository,
  InMemoryWebhookEndpointRepository,
} from "@mayarin/notifications/testing";
import { DerivedRailCatalog, PaymentIntentService } from "@mayarin/payment-intent";
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
  InMemoryWalletWithdrawalRepository,
} from "@mayarin/wallet/testing";
import { AssetCapabilities } from "@mayarin/x402";
import { InMemoryResourceRepository } from "@mayarin/x402/testing";
import { createApp } from "../src/app.ts";
import { type Config, loadConfig } from "../src/config.ts";
import type { Container } from "../src/container.ts";
import { chainReceipts } from "../src/rails.ts";
import { ApiKeyService } from "../src/services/api-key-service.ts";
import { AuthService } from "../src/services/auth-service.ts";
import { CustomerService } from "../src/services/customer-service.ts";
import { EventLogService } from "../src/services/event-log-service.ts";
import type {
  InvoiceEmailSender,
  SendInvoiceEmailRequest,
} from "../src/services/invoice-email-service.ts";
import { MerchantCatalogService } from "../src/services/merchant-catalog-service.ts";
import { MerchantSettingsService } from "../src/services/merchant-settings-service.ts";
import { OrderReadService } from "../src/services/order-read-service.ts";
import { PaymentApiClient } from "../src/services/payment-api-client.ts";
import { PaymentReadService } from "../src/services/payment-read-service.ts";
import { RegistrationService } from "../src/services/registration-service.ts";
import { SessionService } from "../src/services/session-service.ts";
import { SettlementReadService } from "../src/services/settlement-read-service.ts";
import { UserService } from "../src/services/user-service.ts";
import type {
  SendVerificationEmailRequest,
  VerificationEmailSender,
} from "../src/services/verification-email-service.ts";
import { WalletService } from "../src/services/wallet-service.ts";
import { WebhookService } from "../src/services/webhook-service.ts";
import { X402ResourceService } from "../src/services/x402-resource-service.ts";

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
  /**
   * Chains the merchant's settlement address has deployed code on (#244).
   *
   * Absent means no code reader at all, which is a deployment with no RPC
   * access — the settings guard is then skipped, as it is in production.
   */
  readonly contractsOn?: readonly ChainId[];
  readonly rateLimitRequests?: number;
  readonly rateLimitBlockSeconds?: number;
  readonly loginRateLimitRequests?: number;
  /** Email for the seeded merchant-admin account. */
  readonly adminEmail?: string;
  /** Password for the seeded merchant-admin account. */
  readonly adminPassword?: string;
  /** Display name for the seeded merchant. */
  readonly merchantName?: string;
  /** Invoice delivery fake for failure-path tests. */
  readonly invoiceEmailSender?: InvoiceEmailSender;
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
    RATE_LIMIT_BLOCK_SECONDS: String(options.rateLimitBlockSeconds ?? 300),
    DASHBOARD_LOGIN_RATE_LIMIT_REQUESTS: String(options.loginRateLimitRequests ?? 5),
    PAYMENTS_PAGE_SIZE: "7",
    // Two chains with different assets, which is the shape #244 exists for:
    // Base takes ETH and USDC, Arc takes only USDC.
    CHAIN_ASSETS:
      '{"base-sepolia":{"USDC":"0x036CbD53842c5426634e7929541eC2318f3dCF7e"},"arc-testnet":{"USDC":"0x3600000000000000000000000000000000000000"}}',
    CHAIN_NATIVE_ASSETS: '{"base-sepolia":"ETH"}',
    WALLET_PROVISION_CHAINS: "base-sepolia,arc-testnet",
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
      settlementAsset: "USDC",
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
  const walletWithdrawals = new InMemoryWalletWithdrawalRepository();
  // Managed provisioning against the reference fake provider. Deploying a real
  // Safe is proven on testnet; what the route tests are for is the surface
  // around it — scoping, idempotence, and that the two wallet paths coexist.
  const walletProvider = new FakeWalletProvider();
  const merchantKeyProvider = new FakeMerchantKeyProvider();
  const treasuryAddresses = [TREASURY_ADDRESS];
  const walletBalances = new InMemoryWalletBalanceReader();
  const settlementAddressResolver = new SettlementAddressResolver({ wallets: merchantWallets });

  const wallets = new WalletService({
    wallets: merchantWallets,
    withdrawals: walletWithdrawals,
    challenges: walletChallenges,
    // Real recovery: the point of verification is that it agrees with what a
    // wallet actually produces, which a stub cannot demonstrate.
    verifier: new ViemSignatureVerifier(),
    clock,
    treasuryAddresses,
    merchants,
    // Two chains, because the interesting cases only exist with more than one:
    // a merchant provisioned on Base and not on Arc, and a balance that has to
    // be reported per chain rather than for whichever one came first (#244).
    chains: ["base-sepolia", "arc-testnet"],
    provisionChains: ["base-sepolia", "arc-testnet"],
    settlementAddresses: settlementAddressResolver,
    balances: walletBalances,
    walletProvider,
    nativeAssets: { "base-sepolia": "ETH" },
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
  const invoiceRepository = new InMemoryInvoiceRepository();
  const invoices = new InvoiceService({
    invoices: invoiceRepository,
    checkout: {
      checkoutCart: async () => {
        throw new Error("Invoice checkout belongs to the payment API");
      },
    },
    payments: intents,
    clock,
  });
  // Keeps the plaintext code a test needs, which is the one thing the real
  // sender is built never to hand back.
  const verificationEmails: SendVerificationEmailRequest[] = [];
  const verificationEmailSender: VerificationEmailSender = {
    sendVerification: async (request) => {
      verificationEmails.push(request);
      return { id: "eml_test_verification" };
    },
  };
  const registrations = new RegistrationService({
    users,
    accounts,
    verifications: new InMemoryEmailVerificationRepository(),
    hasher,
    emails: verificationEmailSender,
    clock,
    settlementAsset: config.settlementAsset,
  });

  const invoiceEmailCalls: SendInvoiceEmailRequest[] = [];
  const invoiceEmails: InvoiceEmailSender = options.invoiceEmailSender ?? {
    sendInvoice: async (request) => {
      invoiceEmailCalls.push(request);
      return { id: "eml_test_invoice", recipient: request.buyerEmail };
    },
  };

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

  // The same derivation production runs, over the harness's own configuration.
  const rails = new DerivedRailCatalog({
    receipts: chainReceipts(config),
    merchantPolicies: {
      policyFor: async (merchantId: string) => {
        const merchant = await merchants.findById(merchantId);
        return merchant === null
          ? undefined
          : {
              settlementAsset: merchant.settlementAsset,
              acceptedAssets: merchant.acceptedAssets,
              acceptedAssetsByChain: merchant.acceptedAssetsByChain ?? {},
              ...(merchant.settlementAddress === undefined
                ? {}
                : { settlementAddress: merchant.settlementAddress }),
            };
      },
    },
    settlement: {
      destinationFor: (merchantId, chain, configured) =>
        settlementAddressResolver.effective(merchantId, chain, configured),
    },
    // Priceability is the payment API's answer, and the harness does not run
    // one: every configured pair is treated as priceable so these tests exercise
    // the destination and accept-list rules, which are this service's own.
    pricing: { canPrice: async () => true },
    defaultSettlementAsset: config.settlementAsset,
  });

  const x402Resources = new X402ResourceService({
    resources: new InMemoryResourceRepository(),
    merchants,
    wallets: merchantWallets,
    // No RPC in the harness: a probe here would ask a chain that is not there.
    // Tests that register a rail bring their own probe.
    capabilities: new AssetCapabilities({ pairs: [], probes: [] }),
    tokens: config.chainAssets,
    // No payment API in the harness, and the safe answer to "can this
    // deployment swap?" is no.
    crossAssetOperator: async () => undefined,
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
    invoices,
    invoiceEmails,
    registrations,
    customers,
    orders,
    apiKeys,
    settlements: settlementView,
    eventLogs,
    paymentApi,
    webhooks,
    wallets,
    x402Resources,
    merchantWallets,
    settlementAddresses: settlementAddressResolver,
    rails,
    ...(options.contractsOn === undefined
      ? {}
      : {
          contractCode: {
            hasCode: async (chain: ChainId) => options.contractsOn?.includes(chain) === true,
          },
        }),
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
    invoiceRepository,
    invoiceEmailCalls,
    /** Every verification email sent, with its plaintext code. */
    verificationEmails,
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
    walletWithdrawals,
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
