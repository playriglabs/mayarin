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
  MerchantRepository,
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
  DrizzleMerchantRepository,
  DrizzlePaymentIntentRepository,
  DrizzleSessionRepository,
  DrizzleSettlementEventRepository,
  DrizzleUserRepository,
} from "@mayarin/db";
import type { LedgerRepository } from "@mayarin/ledger";
import type { PaymentIntentRepository } from "@mayarin/payment-intent";
import { Argon2PasswordHasher } from "@mayarin/provider-argon2";
import { type Clock, systemClock } from "@mayarin/shared";
import type { Config } from "./config.ts";
import { AuthService } from "./services/auth-service.ts";
import {
  type ClearingReadRepository,
  PaymentReadService,
} from "./services/payment-read-service.ts";
import { SessionService } from "./services/session-service.ts";
import { UserService } from "./services/user-service.ts";

export interface Container {
  readonly config: Config;
  readonly auth: AuthService;
  readonly sessions: SessionService;
  readonly users: UserService;
  readonly payments: PaymentReadService;
  readonly compliance: ComplianceService;
  close(): Promise<void>;
}

export interface CreateContainerOptions {
  readonly config: Config;
  readonly clock?: Clock;
  /** Overridable for tests: in-memory repos instead of Drizzle. */
  readonly userRepository?: UserRepository;
  readonly merchantRepository?: MerchantRepository;
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
  const merchants =
    options.merchantRepository ?? new DrizzleMerchantRepository(handle?.db ?? throwIfNoHandle());
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
  const userService = new UserService({ users, merchants, hasher, clock });

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

  return {
    config,
    auth: authService,
    sessions: sessionService,
    users: userService,
    payments,
    compliance,
    close: () => (handle === undefined ? Promise.resolve() : handle.close()),
  };
}

function throwIfNoHandle(): never {
  throw new Error(
    "createContainer: database handle was not created (provide repos explicitly or set databaseUrl)",
  );
}
