/**
 * Composition root.
 *
 * The only file that names the concrete adapters this deployment runs. The
 * dashboard API is read-only over payments and owns auth/session, so it wires
 * the auth repos, the argon2 hasher, and the payment-intent/clearing read repos
 * — nothing else. No settlement stack, no clearing engine: those live in the
 * payment API. Swapping any adapter is a change here, nowhere else.
 */

import type {
  MerchantAccountRepository,
  MerchantRepository,
  MerchantSettingChangeRepository,
  PasswordHasher,
  SessionRepository,
  UserRepository,
} from "@mayarin/auth";
import type { DepositRepository, SettlementEventRepository } from "@mayarin/chain";
import type { ClearingRepository } from "@mayarin/clearing";
import { type AuditQueryRepository, ComplianceService } from "@mayarin/compliance";
import {
  createDatabase,
  type DatabaseHandle,
  DrizzleAuditQueryRepository,
  DrizzleClearingRepository,
  DrizzleDepositRepository,
  DrizzleLedgerRepository,
  DrizzleMerchantAccountRepository,
  DrizzleMerchantRepository,
  DrizzleMerchantSettingChangeRepository,
  DrizzlePaymentIntentRepository,
  DrizzleSessionRepository,
  DrizzleSettlementEventRepository,
  DrizzleUserRepository,
  DrizzleWebhookDeliveryRepository,
  DrizzleWebhookEndpointRepository,
} from "@mayarin/db";
import type { LedgerRepository } from "@mayarin/ledger";
import type { WebhookDeliveryRepository, WebhookEndpointRepository } from "@mayarin/notifications";
import type { PaymentIntentRepository } from "@mayarin/payment-intent";
import { Argon2PasswordHasher } from "@mayarin/provider-argon2";
import { type Clock, systemClock } from "@mayarin/shared";
import type { Config } from "./config.ts";
import { AuthService } from "./services/auth-service.ts";
import { MerchantSettingsService } from "./services/merchant-settings-service.ts";
import {
  type ClearingReadRepository,
  PaymentReadService,
} from "./services/payment-read-service.ts";
import { SessionService } from "./services/session-service.ts";
import { UserService } from "./services/user-service.ts";
import { WebhookService } from "./services/webhook-service.ts";

export interface Container {
  readonly config: Config;
  readonly auth: AuthService;
  readonly sessions: SessionService;
  readonly users: UserService;
  readonly payments: PaymentReadService;
  readonly compliance: ComplianceService;
  /** Merchant settlement configuration (#95), scoped to the caller's merchant. */
  readonly settings: MerchantSettingsService;
  /** Webhook endpoints and delivery inspection (#13), scoped the same way. */
  readonly webhooks: WebhookService;
  close(): Promise<void>;
}

export interface CreateContainerOptions {
  readonly config: Config;
  readonly clock?: Clock;
  /** Overridable for tests: in-memory repos instead of Drizzle. */
  readonly userRepository?: UserRepository;
  readonly merchantAccountRepository?: MerchantAccountRepository;
  readonly sessionRepository?: SessionRepository;
  readonly paymentIntents?: PaymentIntentRepository;
  readonly clearing?: ClearingReadRepository;
  readonly hasher?: PasswordHasher;
  // The compliance stack. `complianceClearing` is separate from `clearing`
  // because the audit trail needs the full `ClearingRepository`, not the narrow
  // read slice the payment view is happy with.
  readonly audits?: AuditQueryRepository;
  readonly complianceClearing?: ClearingRepository;
  readonly ledger?: LedgerRepository;
  readonly deposits?: DepositRepository;
  readonly settlements?: SettlementEventRepository;
  readonly merchants?: MerchantRepository;
  readonly merchantSettingChanges?: MerchantSettingChangeRepository;
  readonly webhookEndpoints?: WebhookEndpointRepository;
  readonly webhookDeliveries?: WebhookDeliveryRepository;
}

export function createContainer(options: CreateContainerOptions): Container {
  const { config, clock = systemClock } = options;

  let handle: DatabaseHandle | undefined;
  const users =
    options.userRepository ??
    (() => {
      handle = createDatabase({ url: config.databaseUrl });
      return new DrizzleUserRepository(handle.db);
    })();
  const accounts =
    options.merchantAccountRepository ??
    new DrizzleMerchantAccountRepository(handle?.db ?? throwIfNoHandle());
  const sessions =
    options.sessionRepository ?? new DrizzleSessionRepository(handle?.db ?? throwIfNoHandle());
  const hasher = options.hasher ?? new Argon2PasswordHasher();

  const sessionService = new SessionService({
    sessions,
    users,
    clock,
    ttlSeconds: config.sessionTtlSeconds,
  });
  const authService = new AuthService({ users, hasher, sessions: sessionService });
  const userService = new UserService({ users, accounts, hasher, clock });

  const intents =
    options.paymentIntents ?? new DrizzlePaymentIntentRepository(handle?.db ?? throwIfNoHandle());
  const clearing =
    options.clearing ?? new DrizzleClearingRepository(handle?.db ?? throwIfNoHandle());
  const payments = new PaymentReadService({
    intents,
    clearing,
    pageSize: config.paymentsPageSize,
  });

  // The compliance read stack. All repositories, no engine: the audit trail is
  // assembled from records the payment API already wrote, so the dashboard needs
  // read adapters and nothing from the settlement or clearing pipeline.
  const compliance = new ComplianceService({
    audits: options.audits ?? new DrizzleAuditQueryRepository(handle?.db ?? throwIfNoHandle()),
    clearing:
      options.complianceClearing ?? new DrizzleClearingRepository(handle?.db ?? throwIfNoHandle()),
    ledger: options.ledger ?? new DrizzleLedgerRepository(handle?.db ?? throwIfNoHandle()),
    intents,
    deposits: options.deposits ?? new DrizzleDepositRepository(handle?.db ?? throwIfNoHandle()),
    settlements:
      options.settlements ?? new DrizzleSettlementEventRepository(handle?.db ?? throwIfNoHandle()),
  });

  // Merchant settlement configuration (#95). The data model already existed;
  // this is the surface that was missing.
  const settings = new MerchantSettingsService({
    merchants: options.merchants ?? new DrizzleMerchantRepository(handle?.db ?? throwIfNoHandle()),
    changes:
      options.merchantSettingChanges ??
      new DrizzleMerchantSettingChangeRepository(handle?.db ?? throwIfNoHandle()),
    clock,
  });

  // Webhook inspection (#13). The dispatcher itself runs in the payment API;
  // the dashboard only reads and re-queues, scoped to the caller's merchant.
  const webhooks = new WebhookService({
    endpoints:
      options.webhookEndpoints ??
      new DrizzleWebhookEndpointRepository(handle?.db ?? throwIfNoHandle()),
    deliveries:
      options.webhookDeliveries ??
      new DrizzleWebhookDeliveryRepository(handle?.db ?? throwIfNoHandle()),
    clock,
    pageSize: config.paymentsPageSize,
  });

  return {
    config,
    auth: authService,
    sessions: sessionService,
    users: userService,
    payments,
    compliance,
    settings,
    webhooks,
    close: () => (handle === undefined ? Promise.resolve() : handle.close()),
  };
}

function throwIfNoHandle(): never {
  throw new Error(
    "createContainer: database handle was not created (provide repos explicitly or set databaseUrl)",
  );
}
