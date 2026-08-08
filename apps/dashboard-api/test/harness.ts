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

import type { PasswordHasher } from "@mayarin/auth";
import {
  InMemoryMerchantAccountRepository,
  InMemoryMerchantRepository,
  InMemoryMerchantSettingChangeRepository,
  InMemorySessionRepository,
  InMemoryUserRepository,
} from "@mayarin/auth/testing";
import {
  InMemoryDepositRepository,
  InMemorySettlementEventRepository,
} from "@mayarin/chain/testing";
import { InMemoryClearingRepository } from "@mayarin/clearing/testing";
import { ComplianceService } from "@mayarin/compliance";
import { InMemoryAuditQueryRepository } from "@mayarin/compliance/testing";
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
import {
  InMemoryMerchantWalletRepository,
  InMemoryWalletChallengeRepository,
} from "@mayarin/wallet/testing";
import { createApp } from "../src/app.ts";
import { type Config, loadConfig } from "../src/config.ts";
import type { Container } from "../src/container.ts";
import { AuthService } from "../src/services/auth-service.ts";
import { MerchantSettingsService } from "../src/services/merchant-settings-service.ts";
import { PaymentReadService } from "../src/services/payment-read-service.ts";
import { SessionService } from "../src/services/session-service.ts";
import { UserService } from "../src/services/user-service.ts";
import { WalletService } from "../src/services/wallet-service.ts";
import { WebhookService } from "../src/services/webhook-service.ts";

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
    PAYMENTS_PAGE_SIZE: "50",
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
  const payments = new PaymentReadService({ intents, clearing, pageSize: config.paymentsPageSize });

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
  const wallets = new WalletService({
    wallets: merchantWallets,
    challenges: walletChallenges,
    // Real recovery: the point of verification is that it agrees with what a
    // wallet actually produces, which a stub cannot demonstrate.
    verifier: new ViemSignatureVerifier(),
    clock,
  });

  const settingChanges = new InMemoryMerchantSettingChangeRepository();
  const settings = new MerchantSettingsService({ merchants, changes: settingChanges, clock });

  const container: Container = {
    config,
    auth: authService,
    sessions: sessionService,
    users: userService,
    payments,
    compliance,
    settings,
    webhooks,
    wallets,
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
    permissions: ["payments:read", "users:manage", "admin:access", "settings:manage"],
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
    settingChanges,
    webhookEndpoints,
    webhookDeliveries,
    merchantWallets,
    walletChallenges,
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
