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
  ApiKeyRepository,
  MerchantAccountRepository,
  MerchantRepository,
  MerchantSettingChangeRepository,
  PasswordHasher,
  SessionRepository,
  UserRepository,
} from "@mayarin/auth";
import {
  CatalogService,
  type CustomerRepository,
  type PaymentLinkRepository,
  type ProductRepository,
} from "@mayarin/catalog";
import type {
  ChainId,
  ContractCodeSource,
  DepositRepository,
  SettlementEventRepository,
} from "@mayarin/chain";
import type { ClearingRepository } from "@mayarin/clearing";
import {
  type AuditQueryRepository,
  ComplianceService,
  type MerchantEventRepository,
} from "@mayarin/compliance";
import {
  createDatabase,
  type DatabaseHandle,
  DrizzleApiKeyRepository,
  DrizzleAuditQueryRepository,
  DrizzleClearingRepository,
  DrizzleCustomerRepository,
  DrizzleDepositRepository,
  DrizzleInvoiceRepository,
  DrizzleLedgerRepository,
  DrizzleMerchantAccountRepository,
  DrizzleMerchantAssetPolicySource,
  DrizzleMerchantEventRepository,
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
  DrizzleWalletWithdrawalRepository,
  DrizzleWebhookDeliveryRepository,
  DrizzleWebhookEndpointRepository,
  DrizzleX402ResourceRepository,
} from "@mayarin/db";
import { type InvoiceRepository, InvoiceService } from "@mayarin/invoicing";
import type { LedgerRepository } from "@mayarin/ledger";
import type { WebhookDeliveryRepository, WebhookEndpointRepository } from "@mayarin/notifications";
import {
  DerivedRailCatalog,
  type PaymentIntentRepository,
  type RailCatalog,
} from "@mayarin/payment-intent";
import { Argon2PasswordHasher } from "@mayarin/provider-argon2";
import {
  EvmContractCodeReader,
  EvmWalletBalanceReader,
  ViemSignatureVerifier,
} from "@mayarin/provider-evm";
import {
  ApiKeyStamper,
  TurnkeyMerchantKeyProvider,
  TurnkeyWalletProvider,
} from "@mayarin/provider-turnkey";
import { EvmAssetCapabilityProbe } from "@mayarin/provider-x402-local";
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
  type WalletWithdrawalRepository,
} from "@mayarin/wallet";
import { AssetCapabilities } from "@mayarin/x402";
import { createPublicClient, http } from "viem";
import type { Config } from "./config.ts";
import { chainReceipts, PaymentApiPricingSource, settlementChains } from "./rails.ts";
import {
  ApiKeyService,
  type SecretGenerator,
  type SecretHasher,
} from "./services/api-key-service.ts";
import { AuthService } from "./services/auth-service.ts";
import { CustomerService } from "./services/customer-service.ts";
import { EventLogService } from "./services/event-log-service.ts";
import {
  type InvoiceEmailSender,
  ResendInvoiceEmailSender,
  UnavailableInvoiceEmailSender,
} from "./services/invoice-email-service.ts";
import { MerchantCatalogService } from "./services/merchant-catalog-service.ts";
import { MerchantSettingsService } from "./services/merchant-settings-service.ts";
import { OrderReadService } from "./services/order-read-service.ts";
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
import { X402ResourceService } from "./services/x402-resource-service.ts";

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
  /** Numbered invoice lifecycle. Buyer checkout remains in the payment API. */
  readonly invoices: InvoiceService;
  /** Transactional delivery of an issued invoice to its snapshotted buyer. */
  readonly invoiceEmails: InvoiceEmailSender;
  /** The merchant's customer directory, scoped the same way. */
  readonly customers: CustomerService;
  /** The commerce view of the merchant's payments — line items + customer. Read-only. */
  readonly orders: OrderReadService;
  /** Merchant API keys — bearer-token access, per-key permissions. */
  readonly apiKeys: ApiKeyService;
  /** What was paid out, per payment (#15). Read-only. */
  readonly settlements: SettlementReadService;
  /** The merchant's unified event timeline — clearing, settlement, webhooks. Read-only. */
  readonly eventLogs: EventLogService;
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
  /** The merchant's own x402 resources (#208), priced and offered by them. */
  readonly x402Resources: X402ResourceService;
  /**
   * The wallet port itself, exposed for backend-only operator tooling.
   *
   * HTTP handlers use WalletService so claims still require signature proof.
   * The seed CLI alone needs the port for its explicit development trust flag.
   */
  readonly merchantWallets: MerchantWalletRepository;
  /**
   * Where a merchant is paid when they have named no address (#11). Held on the
   * container because the settings surface has to show it: "blank" is not
   * "nowhere", and a merchant should be able to read the answer.
   */
  readonly settlementAddresses: SettlementAddressResolver;
  /**
   * Which `(chain, asset)` pairs this merchant can be paid on, and why not the
   * others (#244).
   *
   * The same derivation the payment API runs for a payer, read here for the
   * merchant: the reasons are what turn "my link does not work on Arc" into a
   * settings change they can make themselves.
   */
  readonly rails: RailCatalog;
  /**
   * Reads deployed code, for the settings guard (#244).
   *
   * A merchant saving a Safe address that exists on one chain and not another
   * is saving an address that will be paid into on a chain where nothing can
   * spend from it. Absent on a deployment with no RPC access, where the save is
   * accepted unchecked because there is no chain to strand funds on.
   */
  readonly contractCode?: ContractCodeSource;
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
  /** Invoice repo. A test supplies the reference in-memory adapter. */
  readonly invoiceRepository?: InvoiceRepository;
  /** Overridable for tests: a recorder rather than the Resend network adapter. */
  readonly invoiceEmails?: InvoiceEmailSender;
  /** Customer directory repo. A test supplies an in-memory fake. */
  readonly customers?: CustomerRepository;
  /** API key repo. A test supplies an in-memory fake. */
  readonly apiKeysRepo?: ApiKeyRepository;
  /** Event log repo. A test supplies an in-memory fake. */
  readonly eventLogRepo?: MerchantEventRepository;
  /** Overridable for tests: a fixed secret generator rather than random bytes. */
  readonly secretGenerator?: SecretGenerator;
  /** Overridable for tests: a plain hasher rather than sha-256. */
  readonly secretHasher?: SecretHasher;
  /** The bulk clearing read the settlement view needs, separate from `clearing`. */
  readonly settlementClearing?: ClearingBulkReadRepository;
  readonly settlementEvents?: SettlementEventReadRepository;
  readonly webhookEndpoints?: WebhookEndpointRepository;
  readonly webhookDeliveries?: WebhookDeliveryRepository;
  readonly merchantWallets?: MerchantWalletRepository;
  readonly walletChallenges?: WalletChallengeRepository;
  readonly walletWithdrawals?: WalletWithdrawalRepository;
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
    clock,
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

  // Invoice documents share Postgres with the payment API. The dashboard owns
  // create/issue/void only; checkout is deliberately unavailable here because
  // minting a payment belongs to the payment API's clearing composition.
  const invoices = new InvoiceService({
    invoices:
      options.invoiceRepository ?? new DrizzleInvoiceRepository(handle?.db ?? throwIfNoHandle()),
    checkout: {
      checkoutCart: () =>
        Promise.reject(new ConfigurationError("Invoice checkout is served by the payment API", {})),
    },
    payments: intents,
    clock,
  });
  const invoiceEmails =
    options.invoiceEmails ??
    (config.resendApiKey === undefined
      ? new UnavailableInvoiceEmailSender()
      : new ResendInvoiceEmailSender({
          apiKey: config.resendApiKey,
          from: config.invoiceEmailFrom,
        }));

  // The merchant's customer directory, and the commerce view of their payments.
  // `orders` reads the customer repo to resolve `metadata.customerId`; `customers`
  // reads `orders` back for a customer's linked orders and lifetime value. The
  // repo is shared, and `orders` is built first so `customers` can take it.
  const customerRepository =
    options.customers ?? new DrizzleCustomerRepository(handle?.db ?? throwIfNoHandle());
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

  // Merchant API keys — bearer-token access with per-key permissions. The repo
  // is separate from the session/auth stack: a bearer request is looked up by
  // the hash of the presented secret, not by a session id.
  const apiKeyRepository =
    options.apiKeysRepo ?? new DrizzleApiKeyRepository(handle?.db ?? throwIfNoHandle());
  const apiKeys = new ApiKeyService({
    keys: apiKeyRepository,
    clock,
    ...(options.secretGenerator === undefined ? {} : { secretGenerator: options.secretGenerator }),
    ...(options.secretHasher === undefined ? {} : { secretHasher: options.secretHasher }),
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

  // The merchant event timeline — a derived read over clearing, settlement, and
  // webhook events. Three bounded queries merged in JS, no table of its own.
  const eventLogs = new EventLogService({
    events:
      options.eventLogRepo ?? new DrizzleMerchantEventRepository(handle?.db ?? throwIfNoHandle()),
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
  const chains = settlementChains(config);
  const wallets = new WalletService({
    wallets: walletRepository,
    withdrawals:
      options.walletWithdrawals ??
      new DrizzleWalletWithdrawalRepository(handle?.db ?? throwIfNoHandle()),
    challenges:
      options.walletChallenges ??
      new DrizzleWalletChallengeRepository(handle?.db ?? throwIfNoHandle()),
    verifier: options.signatureVerifier ?? new ViemSignatureVerifier(),
    clock,
    treasuryAddresses,
    merchants,
    chains,
    provisionChains: config.walletProvisionChains,
    settlementAddresses,
    ...(balanceReader === undefined ? {} : { balances: balanceReader }),
    ...(walletProvider === undefined ? {} : { walletProvider }),
    nativeAssets: config.chainNativeAssets,
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

  const paymentApi = options.paymentApi ?? new PaymentApiClient({ baseUrl: config.paymentApiUrl });

  const contractCode =
    Object.keys(config.chainRpcUrls).length === 0
      ? undefined
      : new EvmContractCodeReader({ rpcUrls: config.chainRpcUrls });

  // The chain's own answer about each token, asked once and cached, so a rail a
  // merchant registers advertises what the contract implements rather than what
  // the form assumed.
  const x402Resources = new X402ResourceService({
    resources: new DrizzleX402ResourceRepository(handle?.db ?? throwIfNoHandle()),
    merchants,
    wallets: walletRepository,
    capabilities: new AssetCapabilities({
      pairs: [],
      probes: Object.entries(config.chainRpcUrls).flatMap(([chain, rpcUrl]) =>
        rpcUrl === undefined
          ? []
          : [
              new EvmAssetCapabilityProbe({
                chain: chain as ChainId,
                publicClient: createPublicClient({ transport: http(rpcUrl) }),
              }),
            ],
      ),
    }),
    tokens: config.chainAssets,
    crossAssetOperator: () => crossAssetOperator(config),
  });

  const rails = new DerivedRailCatalog({
    receipts: chainReceipts(config),
    merchantPolicies: new DrizzleMerchantAssetPolicySource(merchants),
    settlement: {
      destinationFor: (merchantId, chain, configured) =>
        settlementAddresses.effective(merchantId, chain, configured),
    },
    pricing: new PaymentApiPricingSource(paymentApi),
    defaultSettlementAsset: config.settlementAsset,
    ...(contractCode === undefined ? {} : { code: contractCode }),
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
    invoices,
    invoiceEmails,
    customers,
    orders,
    apiKeys,
    settlements,
    eventLogs,
    paymentApi,
    webhooks,
    wallets,
    x402Resources,
    merchantWallets: walletRepository,
    settlementAddresses,
    rails,
    ...(contractCode === undefined ? {} : { contractCode }),
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
/**
 * Where a cross-asset rail pays, as the payment API reports it.
 *
 * Read rather than derived: the operator address belongs to the deployment that
 * holds the key and runs the swap, and a second opinion here would be a second
 * thing to keep in step — one that, when it drifted, would offer a merchant a
 * rail their own registration then refuses. A deployment with no quote layer
 * answers that it cannot serve one, and an unreachable payment API is treated
 * as the same answer: declining to offer a rail is always safe.
 */
async function crossAssetOperator(config: Config): Promise<string | undefined> {
  try {
    const response = await fetch(`${config.paymentApiUrl}/x402/cross-asset`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return undefined;
    const body: unknown = await response.json();
    const operator =
      typeof body === "object" && body !== null && "operator" in body
        ? (body as { operator: unknown }).operator
        : undefined;
    return typeof operator === "string" ? operator : undefined;
  } catch {
    return undefined;
  }
}

function createBalanceReader(config: Config): WalletBalanceReader | undefined {
  // Every chain this deployment can reach, not just the one it provisions on
  // by default — a merchant paid on two chains has a balance on each, and the
  // reader is keyed by chain already.
  const rpcUrls: Partial<Record<ChainId, string>> = { ...config.chainRpcUrls };
  if (config.walletProvisionRpcUrl !== undefined) {
    rpcUrls[config.walletProvisionChains[0]] ??= config.walletProvisionRpcUrl;
  }
  if (Object.keys(rpcUrls).length === 0) return undefined;

  return new EvmWalletBalanceReader({
    rpcUrls,
    tokens: config.chainAssets,
    nativeAssets: config.chainNativeAssets,
  });
}

/**
 * A provider per chain, behind one port.
 *
 * `TurnkeyWalletProvider` deploys on exactly one chain and refuses a request for
 * another — deliberately, since its RPC and its token table are per chain. So a
 * deployment that provisions on several chains holds one per chain, built from
 * `WALLET_PROVISION_CHAINS` alone, and this routes by the chain the request
 * names.
 *
 * The address is not per chain. The provisioner reuses one signer set and one
 * salt chain for a merchant everywhere, and every chain carries the same
 * canonical Safe contracts — so the merchant's Safe has the same address on each,
 * and a chain added to the list later needs no code here.
 */
function createWalletProvider(config: Config): WalletProvider | undefined {
  if (!config.walletProvisioningEnabled) return undefined;

  const providers = new Map<ChainId, WalletProvider>(
    config.walletProvisionChains.map((chain) => [chain, providerFor(config, chain)]),
  );

  const providerOn = (chain: ChainId): WalletProvider => {
    const provider = providers.get(chain);
    if (provider === undefined) {
      throw new ConfigurationError(
        `This deployment provisions on ${config.walletProvisionChains.join(", ")}, not ${chain}`,
        { chain },
      );
    }
    return provider;
  };

  // Creating the merchant's signer touches no chain, so it goes to the default
  // one: a second sub-organization per chain would give one merchant two
  // signers and two policies to keep in step.
  const [first] = config.walletProvisionChains;
  const primary = providerOn(first as ChainId);

  return {
    createManagedSigner: (merchantId) => primary.createManagedSigner(merchantId),
    predictAddress: (request) => providerOn(request.chain).predictAddress(request),
    deploy: (request) => providerOn(request.chain).deploy(request),
    // Routed by the wallet's own chain: an intent says what to move, the
    // wallet says where it lives.
    propose: (wallet, intent) => providerOn(wallet.chain).propose(wallet, intent),
  };
}

function providerFor(config: Config, chain: ChainId): WalletProvider {
  const tokens = config.chainAssets[chain];
  const nativeAsset = config.chainNativeAssets[chain];
  const rpcUrl = config.chainRpcUrls[chain] ?? config.walletProvisionRpcUrl;
  // Denominated in this chain's own currency, so it cannot be one number for
  // every chain: the provider's ETH-shaped default is worth a fraction of a
  // cent on a chain whose currency is a stablecoin.
  const gasTopUpBound = config.walletGasTopUpBounds[chain];

  if (rpcUrl === undefined) {
    throw new ConfigurationError(
      `WALLET_PROVISION_CHAINS names ${chain}, which has no CHAIN_RPC_URLS entry to deploy through`,
      { chain },
    );
  }

  return new TurnkeyWalletProvider({
    ...(tokens === undefined ? {} : { tokens }),
    ...(nativeAsset === undefined ? {} : { nativeAsset }),
    ...(gasTopUpBound === undefined ? {} : { maxGasTopUpWei: BigInt(gasTopUpBound) }),
    organizationId: required(config.turnkeyOrganizationId, "TURNKEY_ORGANIZATION_ID"),
    stamper: new ApiKeyStamper({
      apiPublicKey: required(config.turnkeyApiPublicKey, "TURNKEY_API_PUBLIC_KEY"),
      apiPrivateKey: required(config.turnkeyApiPrivateKey, "TURNKEY_API_PRIVATE_KEY"),
    }),
    chain,
    deployerPrivateKey: required(
      config.walletDeployerPrivateKey,
      "WALLET_DEPLOYER_PRIVATE_KEY",
    ) as `0x${string}`,
    rpcUrl,
    // No Safe table: the provider matches the canonical contracts on this chain
    // before it derives anything, and refuses a chain without them.
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
