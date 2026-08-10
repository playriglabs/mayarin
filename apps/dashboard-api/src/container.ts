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
import {
  CatalogService,
  type PaymentLinkRepository,
  type ProductRepository,
} from "@mayarin/catalog";
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
  DrizzleMerchantWalletRepository,
  DrizzlePaymentIntentRepository,
  DrizzlePaymentLinkRepository,
  DrizzleProductRepository,
  DrizzleSessionRepository,
  DrizzleSettlementEventRepository,
  DrizzleUserRepository,
  DrizzleWalletChallengeRepository,
  DrizzleWebhookDeliveryRepository,
  DrizzleWebhookEndpointRepository,
} from "@mayarin/db";
import type { LedgerRepository } from "@mayarin/ledger";
import type { WebhookDeliveryRepository, WebhookEndpointRepository } from "@mayarin/notifications";
import type { PaymentIntentRepository } from "@mayarin/payment-intent";
import { Argon2PasswordHasher } from "@mayarin/provider-argon2";
import { EvmWalletBalanceReader, ViemSignatureVerifier } from "@mayarin/provider-evm";
import {
  ApiKeyStamper,
  SAFE_BASE_SEPOLIA,
  TurnkeyMerchantKeyProvider,
  TurnkeyWalletProvider,
} from "@mayarin/provider-turnkey";
import { type Clock, ConfigurationError, systemClock } from "@mayarin/shared";
import {
  ManagedWalletProvisioner,
  type MerchantKeyProvider,
  type MerchantWalletRepository,
  SettlementAddressResolver,
  type SignatureVerifier,
  type WalletBalanceReader,
  type WalletChallengeRepository,
  type WalletProvider,
} from "@mayarin/wallet";
import type { Config } from "./config.ts";
import { AuthService } from "./services/auth-service.ts";
import { MerchantCatalogService } from "./services/merchant-catalog-service.ts";
import { MerchantSettingsService } from "./services/merchant-settings-service.ts";
import { PaymentApiClient } from "./services/payment-api-client.ts";
import {
  type ClearingReadRepository,
  PaymentReadService,
} from "./services/payment-read-service.ts";
import { SessionService } from "./services/session-service.ts";
import {
  type ClearingBulkReadRepository,
  type SettlementEventReadRepository,
  SettlementReadService,
} from "./services/settlement-read-service.ts";
import { UserService } from "./services/user-service.ts";
import { WalletService } from "./services/wallet-service.ts";
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
  /** Products and payment links (#15), scoped the same way. */
  readonly catalog: MerchantCatalogService;
  /** What was paid out, per payment (#15). Read-only. */
  readonly settlements: SettlementReadService;
  /**
   * The payment API, as a client (#15).
   *
   * Taking a payment at the counter is minting one, and the service that mints
   * payments is `apps/api`. The dashboard is a consumer of the same primitives
   * a third-party POS would use rather than a second implementation of them.
   */
  readonly paymentApi: PaymentApiClient;
  /** Webhook endpoints and delivery inspection (#13), scoped the same way. */
  readonly webhooks: WebhookService;
  /** Merchant wallets and proof of control (#11). */
  readonly wallets: WalletService;
  /**
   * Where a merchant is paid when they have named no address (#11). Held on the
   * container because the settings surface has to show it: "blank" is not
   * "nowhere", and a merchant should be able to read the answer.
   */
  readonly settlementAddresses: SettlementAddressResolver;
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
  readonly products?: ProductRepository;
  readonly paymentLinks?: PaymentLinkRepository;
  /** The bulk clearing read the settlement view needs, separate from `clearing`. */
  readonly settlementClearing?: ClearingBulkReadRepository;
  readonly settlementEvents?: SettlementEventReadRepository;
  readonly webhookEndpoints?: WebhookEndpointRepository;
  readonly webhookDeliveries?: WebhookDeliveryRepository;
  readonly merchantWallets?: MerchantWalletRepository;
  readonly walletChallenges?: WalletChallengeRepository;
  readonly signatureVerifier?: SignatureVerifier;
  /**
   * Managed wallet provisioning (#11). A test supplies a fake; a deployment
   * gets one built from config, and only when it is fully configured.
   */
  readonly walletProvider?: WalletProvider;
  readonly merchantKeyProvider?: MerchantKeyProvider;
  /** Reads on-chain settlement balances. A test supplies a fake rather than an RPC. */
  readonly walletBalances?: WalletBalanceReader;
  /** Overridable for tests: a fake payment API rather than a real HTTP one. */
  readonly paymentApi?: PaymentApiClient;
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
  const merchants =
    options.merchants ?? new DrizzleMerchantRepository(handle?.db ?? throwIfNoHandle());
  const settings = new MerchantSettingsService({
    merchants,
    changes:
      options.merchantSettingChanges ??
      new DrizzleMerchantSettingChangeRepository(handle?.db ?? throwIfNoHandle()),
    clock,
  });

  // Products and payment links (#15). The same commerce service the payment API
  // runs, with the merchant taken from the session rather than the request — the
  // dashboard's merchant is whoever is signed in.
  const catalogProducts =
    options.products ?? new DrizzleProductRepository(handle?.db ?? throwIfNoHandle());
  const catalog = new MerchantCatalogService({
    catalog: new CatalogService({
      products: catalogProducts,
      links:
        options.paymentLinks ?? new DrizzlePaymentLinkRepository(handle?.db ?? throwIfNoHandle()),
      clock,
    }),
    settings,
    products: catalogProducts,
  });

  // What the merchant was actually paid (#15). Assembled from records the
  // payment API and the indexer already wrote, so this is three read ports and
  // no engine.
  const settlements = new SettlementReadService({
    payments,
    clearing:
      options.settlementClearing ?? new DrizzleClearingRepository(handle?.db ?? throwIfNoHandle()),
    settlements:
      options.settlementEvents ??
      new DrizzleSettlementEventRepository(handle?.db ?? throwIfNoHandle()),
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

  // Wallets (#11). Two paths: connect-existing, which needs only a signature
  // verifier, and managed provisioning, which needs a wallet provider and is
  // absent unless this deployment configured one.
  const walletRepository =
    options.merchantWallets ?? new DrizzleMerchantWalletRepository(handle?.db ?? throwIfNoHandle());
  const treasuryAddresses = config.treasuryAddress === undefined ? [] : [config.treasuryAddress];
  const walletProvider = options.walletProvider ?? createWalletProvider(config);
  const keyProvider = options.merchantKeyProvider ?? createMerchantKeyProvider(config);
  const settlementAddresses = new SettlementAddressResolver({ wallets: walletRepository });
  const balanceReader = options.walletBalances ?? createBalanceReader(config);
  const nativeAsset = config.chainNativeAssets[config.walletProvisionChain];
  const wallets = new WalletService({
    wallets: walletRepository,
    challenges:
      options.walletChallenges ??
      new DrizzleWalletChallengeRepository(handle?.db ?? throwIfNoHandle()),
    verifier: options.signatureVerifier ?? new ViemSignatureVerifier(),
    clock,
    treasuryAddresses,
    merchants,
    chain: config.walletProvisionChain,
    settlementAddresses,
    ...(balanceReader === undefined ? {} : { balances: balanceReader }),
    ...(walletProvider === undefined ? {} : { walletProvider }),
    ...(nativeAsset === undefined ? {} : { nativeAsset }),
    ...(keyProvider === undefined ? {} : { keyProvider }),
    ...(walletProvider === undefined
      ? {}
      : {
          provisioner: new ManagedWalletProvisioner({
            wallets: walletRepository,
            provider: walletProvider,
            clock,
            treasuryAddresses,
          }),
        }),
  });

  return {
    config,
    auth: authService,
    sessions: sessionService,
    users: userService,
    payments,
    compliance,
    settings,
    catalog,
    settlements,
    paymentApi: options.paymentApi ?? new PaymentApiClient({ baseUrl: config.paymentApiUrl }),
    webhooks,
    wallets,
    settlementAddresses,
    close: () => (handle === undefined ? Promise.resolve() : handle.close()),
  };
}

/**
 * The wallet provider this deployment provisions with, if it has one.
 *
 * `undefined` when provisioning is switched off, which makes the endpoint
 * refuse with a message rather than a deployment quietly having a provisioning
 * path that fails at the first merchant who uses it. Config validation has
 * already established that the credentials are all present when the flag is on.
 */
/**
 * Reads settlement balances, on a deployment that can reach a chain.
 *
 * Keyed off the RPC URL rather than off provisioning: a merchant who configured
 * their own settlement address has a balance worth showing whether or not this
 * deployment can provision wallets.
 */
function createBalanceReader(config: Config): WalletBalanceReader | undefined {
  const rpcUrl = config.walletProvisionRpcUrl;
  if (rpcUrl === undefined) return undefined;

  return new EvmWalletBalanceReader({
    rpcUrls: { [config.walletProvisionChain]: rpcUrl },
    tokens: config.chainAssets,
    nativeAssets: config.chainNativeAssets,
  });
}

function createWalletProvider(config: Config): WalletProvider | undefined {
  if (!config.walletProvisioningEnabled) return undefined;

  const tokens = config.chainAssets[config.walletProvisionChain];
  const nativeAsset = config.chainNativeAssets[config.walletProvisionChain];

  return new TurnkeyWalletProvider({
    ...(tokens === undefined ? {} : { tokens }),
    ...(nativeAsset === undefined ? {} : { nativeAsset }),
    organizationId: required(config.turnkeyOrganizationId, "TURNKEY_ORGANIZATION_ID"),
    stamper: new ApiKeyStamper({
      apiPublicKey: required(config.turnkeyApiPublicKey, "TURNKEY_API_PUBLIC_KEY"),
      apiPrivateKey: required(config.turnkeyApiPrivateKey, "TURNKEY_API_PRIVATE_KEY"),
    }),
    chain: config.walletProvisionChain,
    deployerPrivateKey: required(
      config.walletDeployerPrivateKey,
      "WALLET_DEPLOYER_PRIVATE_KEY",
    ) as `0x${string}`,
    rpcUrl: required(config.walletProvisionRpcUrl, "WALLET_PROVISION_RPC_URL"),
    safe: SAFE_BASE_SEPOLIA,
    rootApiPublicKey: required(config.turnkeyApiPublicKey, "TURNKEY_API_PUBLIC_KEY"),
    signerApiPublicKey: required(config.turnkeySignerApiPublicKey, "TURNKEY_SIGNER_API_PUBLIC_KEY"),
  });
}

/**
 * The provider that creates keys the merchant holds, if this deployment has one.
 *
 * Only the parent organization and the stamper: no deployer key, no RPC, no Safe
 * addresses. Creating a key the merchant alone can use touches no chain — which
 * is also why the merchant needs no gas to get one.
 */
function createMerchantKeyProvider(config: Config): MerchantKeyProvider | undefined {
  if (!config.walletProvisioningEnabled) return undefined;

  return new TurnkeyMerchantKeyProvider({
    organizationId: required(config.turnkeyOrganizationId, "TURNKEY_ORGANIZATION_ID"),
    stamper: new ApiKeyStamper({
      apiPublicKey: required(config.turnkeyApiPublicKey, "TURNKEY_API_PUBLIC_KEY"),
      apiPrivateKey: required(config.turnkeyApiPrivateKey, "TURNKEY_API_PRIVATE_KEY"),
    }),
  });
}

function required(value: string | undefined, name: string): string {
  if (value === undefined) {
    throw new ConfigurationError(
      `${name} is required when WALLET_PROVISIONING_ENABLED is true`,
      {},
    );
  }
  return value;
}

function throwIfNoHandle(): never {
  throw new Error(
    "createContainer: database handle was not created (provide repos explicitly or set databaseUrl)",
  );
}
