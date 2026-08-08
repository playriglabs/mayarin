/**
 * Drizzle schema.
 *
 * Conventions that hold across every table:
 *
 * - Money is stored as `numeric(78, 0)` — an exact integer count of minor units,
 *   wide enough for 18-decimal token balances — paired with its asset code.
 *   Never a float, never a plain bigint column.
 * - Ids are the application's prefixed ULIDs, so they sort by creation time.
 * - `version` columns back optimistic concurrency control.
 * - Ledger and event tables are append-only; nothing in the application updates
 *   them.
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** Minor-unit amount column. 78 digits covers uint256-scale balances. */
const minorUnits = (name: string) => numeric(name, { precision: 78, scale: 0 });

const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "date" }).notNull();

export const paymentIntents = pgTable(
  "payment_intents",
  {
    id: text("id").primaryKey(),
    status: text("status").notNull(),

    merchantId: text("merchant_id").notNull(),
    merchantName: text("merchant_name").notNull(),
    merchantCity: text("merchant_city").notNull(),
    merchantCountryCode: text("merchant_country_code").notNull(),
    merchantCategoryCode: text("merchant_category_code"),

    amount: minorUnits("amount").notNull(),
    amountAsset: text("amount_asset").notNull(),
    settlementAsset: text("settlement_asset").notNull(),
    provider: text("provider").notNull(),

    paymentAsset: text("payment_asset"),
    paymentChain: text("payment_chain"),
    // How the payment rail is executed. Null for a fiat-only intent.
    executionPath: text("execution_path"),

    sourceType: text("source_type").notNull(),
    sourceScheme: text("source_scheme"),
    sourcePayload: text("source_payload"),

    metadata: jsonb("metadata").$type<Record<string, string>>().notNull().default({}),
    /** The merchant's own order id. Opaque here, deliberately not unique. */
    merchantReference: text("merchant_reference"),
    idempotencyKey: text("idempotency_key"),
    requestFingerprint: text("request_fingerprint"),
    clearingTransactionId: text("clearing_transaction_id"),
    failureReason: text("failure_reason"),

    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: "date" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),

    version: integer("version").notNull(),
  },
  (table) => [
    uniqueIndex("payment_intents_idempotency_key_idx").on(table.idempotencyKey),
    index("payment_intents_merchant_idx").on(table.merchantId),
    index("payment_intents_status_idx").on(table.status),
    // Leading on `merchant_id` keeps a merchant's reference lookup on their own
    // rows: two merchants may both call an order "INV-1".
    index("payment_intents_merchant_reference_idx").on(table.merchantId, table.merchantReference),
  ],
);

export const clearingTransactions = pgTable(
  "clearing_transactions",
  {
    id: text("id").primaryKey(),
    paymentIntentId: text("payment_intent_id")
      .notNull()
      .references(() => paymentIntents.id),
    state: text("state").notNull(),

    merchantId: text("merchant_id").notNull(),
    merchantName: text("merchant_name").notNull(),
    merchantCity: text("merchant_city").notNull(),
    merchantCountryCode: text("merchant_country_code").notNull(),

    sourceAmount: minorUnits("source_amount").notNull(),
    sourceAsset: text("source_asset").notNull(),
    settlementAsset: text("settlement_asset").notNull(),
    provider: text("provider").notNull(),
    // Copied from the intent at creation; null for a fiat-only transaction.
    executionPath: text("execution_path"),

    rateFrom: text("rate_from"),
    rateTo: text("rate_to"),
    rateScaled: minorUnits("rate_scaled"),
    rateSource: text("rate_source"),
    rateLockedAt: timestamp("rate_locked_at", { withTimezone: true, mode: "date" }),
    rateExpiresAt: timestamp("rate_expires_at", { withTimezone: true, mode: "date" }),

    settlementAmount: minorUnits("settlement_amount"),
    feeAmount: minorUnits("fee_amount"),
    netAmount: minorUnits("net_amount"),

    depositAsset: text("deposit_asset"),
    depositChain: text("deposit_chain"),
    depositAddress: text("deposit_address"),
    depositAmount: minorUnits("deposit_amount"),
    depositRateScaled: minorUnits("deposit_rate_scaled"),
    depositRateSource: text("deposit_rate_source"),
    depositRateLockedAt: timestamp("deposit_rate_locked_at", { withTimezone: true, mode: "date" }),
    depositRateExpiresAt: timestamp("deposit_rate_expires_at", {
      withTimezone: true,
      mode: "date",
    }),

    // The contract-path lock (#61). Written at PRICE_LOCKED and read back by
    // every later step: the signed order is never re-signed on resume, and
    // `contract_intent_id` is what the indexer resolves a `PaymentCompleted`
    // log to.
    contractIntentId: text("contract_intent_id"),
    contractSettlementToken: text("contract_settlement_token"),
    contractMinOut: minorUnits("contract_min_out"),
    contractFee: minorUnits("contract_fee"),
    contractMerchantSafe: text("contract_merchant_safe"),
    contractRefundTo: text("contract_refund_to"),
    contractDeadline: minorUnits("contract_deadline"),
    contractSignature: text("contract_signature"),
    contractSigner: text("contract_signer"),
    contractPayerEstimate: minorUnits("contract_payer_estimate"),
    contractPayerAsset: text("contract_payer_asset"),
    contractExpiresAt: timestamp("contract_expires_at", { withTimezone: true, mode: "date" }),
    contractTxHash: text("contract_tx_hash"),

    // What `PaymentCompleted` reported (#12). Kept beside the locked figures
    // rather than replacing them: a payment where the two differ is the signal
    // that a route behaved unexpectedly, and overwriting erases the comparison.
    onChainSettledAmount: minorUnits("on_chain_settled_amount"),
    onChainFee: minorUnits("on_chain_fee"),
    onChainRefundAmount: minorUnits("on_chain_refund_amount"),

    providerReference: text("provider_reference"),
    failureReason: text("failure_reason"),
    failureCode: text("failure_code"),
    failureAt: timestamp("failure_at", { withTimezone: true, mode: "date" }),

    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
    version: integer("version").notNull(),
  },
  (table) => [
    // One clearing transaction per intent — the database enforces it, not just
    // the engine.
    uniqueIndex("clearing_transactions_payment_intent_idx").on(table.paymentIntentId),
    uniqueIndex("clearing_transactions_provider_reference_idx").on(
      table.provider,
      table.providerReference,
    ),
    index("clearing_transactions_state_idx").on(table.state, table.createdAt),
    // The audit trail's entry point (#16): one merchant, newest first, bounded
    // by a time window. Leading on `merchant_id` keeps a compliance query on one
    // tenant's rows instead of scanning every payment the deployment ever took.
    index("clearing_transactions_merchant_idx").on(table.merchantId, table.createdAt),
    // The indexer resolves a `PaymentCompleted` log to a payment through this,
    // and the contract consumes each `intentId` exactly once — so two rows
    // sharing one is a state the chain itself cannot produce.
    uniqueIndex("clearing_transactions_contract_intent_idx").on(table.contractIntentId),
  ],
);

export const clearingEvents = pgTable(
  "clearing_events",
  {
    id: text("id").primaryKey(),
    clearingTransactionId: text("clearing_transaction_id")
      .notNull()
      .references(() => clearingTransactions.id),
    sequence: integer("sequence").notNull(),
    type: text("type").notNull(),
    fromState: text("from_state"),
    toState: text("to_state").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    // Gapless, ordered history per transaction.
    uniqueIndex("clearing_events_sequence_idx").on(table.clearingTransactionId, table.sequence),
  ],
);

export const ledgerAccounts = pgTable(
  "ledger_accounts",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    asset: text("asset").notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("ledger_accounts_code_idx").on(table.code)],
);

export const ledgerTransactions = pgTable(
  "ledger_transactions",
  {
    id: text("id").primaryKey(),
    description: text("description").notNull(),
    reference: text("reference"),
    idempotencyKey: text("idempotency_key"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("ledger_transactions_idempotency_key_idx").on(table.idempotencyKey),
    index("ledger_transactions_reference_idx").on(table.reference),
  ],
);

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: text("id").primaryKey(),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => ledgerTransactions.id),
    accountId: text("account_id")
      .notNull()
      .references(() => ledgerAccounts.id),
    accountCode: text("account_code").notNull(),
    direction: text("direction").notNull(),
    amount: minorUnits("amount").notNull(),
    asset: text("asset").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("ledger_entries_account_idx").on(table.accountId),
    index("ledger_entries_transaction_idx").on(table.transactionId),
  ],
);

/**
 * Per-payment deposit addresses.
 *
 * `derivationIndex` is the address's identity: persisting it is what makes every
 * address re-derivable from the extended public key alone after a restore.
 */
export const depositAddresses = pgTable(
  "deposit_addresses",
  {
    id: text("id").primaryKey(),
    clearingTransactionId: text("clearing_transaction_id")
      .notNull()
      .references(() => clearingTransactions.id),
    derivationIndex: integer("derivation_index").notNull(),
    chain: text("chain").notNull(),
    asset: text("asset").notNull(),
    address: text("address").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("deposit_addresses_clearing_idx").on(table.clearingTransactionId),
    uniqueIndex("deposit_addresses_address_idx").on(table.chain, table.address),
    uniqueIndex("deposit_addresses_index_idx").on(table.derivationIndex),
  ],
);

/**
 * Observed inbound transfers.
 *
 * `(chain, tx_hash, log_index)` is the natural idempotency key: re-scanning a
 * block range after a crash cannot double-count. Nothing here touches a ledger
 * account — a deposit is an observation, not a posting.
 */
export const chainDeposits = pgTable(
  "chain_deposits",
  {
    id: text("id").primaryKey(),
    chain: text("chain").notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    address: text("address").notNull(),
    asset: text("asset").notNull(),
    amount: minorUnits("amount").notNull(),
    blockNumber: minorUnits("block_number").notNull(),
    blockHash: text("block_hash").notNull(),
    status: text("status").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true, mode: "date" }).notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: "date" }),
    orphanedAt: timestamp("orphaned_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    uniqueIndex("chain_deposits_log_idx").on(table.chain, table.txHash, table.logIndex),
    index("chain_deposits_address_idx").on(table.chain, table.address),
    index("chain_deposits_status_idx").on(table.chain, table.status, table.blockNumber),
  ],
);

/** How far the watcher has scanned, per chain and asset. */
/**
 * `PaymentCompleted` logs read from a `PaymentRouter` (#8).
 *
 * Keyed by `(chain, tx_hash, log_index)` — the identity the log envelope itself
 * carries, so replaying a block range cannot record a settlement twice. The
 * amounts are the on-chain truth the ledger reconciles against: what the
 * merchant was actually paid, not what was quoted.
 */
export const settlementEvents = pgTable(
  "settlement_events",
  {
    id: text("id").primaryKey(),
    chain: text("chain").notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    blockNumber: minorUnits("block_number").notNull(),
    blockHash: text("block_hash").notNull(),
    intentId: text("intent_id").notNull(),
    merchantSafe: text("merchant_safe").notNull(),
    settledAmount: minorUnits("settled_amount").notNull(),
    fee: minorUnits("fee").notNull(),
    refundAmount: minorUnits("refund_amount").notNull(),
    status: text("status").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true, mode: "date" }).notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: "date" }),
    orphanedAt: timestamp("orphaned_at", { withTimezone: true, mode: "date" }),
    /** Set once the clearing engine has been told; keeps completion at-most-once. */
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    uniqueIndex("settlement_events_log_idx").on(table.chain, table.txHash, table.logIndex),
    index("settlement_events_intent_idx").on(table.intentId),
    index("settlement_events_probe_idx").on(table.chain, table.status, table.blockNumber),
  ],
);

export const watcherCursors = pgTable(
  "watcher_cursors",
  {
    chain: text("chain").notNull(),
    asset: text("asset").notNull(),
    lastBlock: minorUnits("last_block").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.chain, table.asset] })],
);

/**
 * Merchant account tenants. Every dashboard user belongs to one merchant; the
 * merchant id also keys which payments the user can see (`payment_intents.
 * merchant_id` must equal it). New merchants get an `mrc_<ulid>` id; historical
 * payment-merchant ids are preserved as-is on migration.
 */
export const merchants = pgTable(
  "merchants",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    /** The one asset this merchant is paid in. */
    settlementAsset: text("settlement_asset").notNull(),
    /** Assets a payer may pay this merchant with. Empty defers to the deployment. */
    acceptedAssets: text("accepted_assets").array().notNull(),
    /** Where the merchant is paid on-chain — the order's `merchantSafe`. */
    settlementAddress: text("settlement_address"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
    /** Optimistic concurrency control; settlement settings redirect money. */
    version: integer("version").notNull(),
  },
  (table) => [index("merchants_name_idx").on(table.name)],
);

/**
 * Dashboard users. Every user is a merchant account: `merchantId` is required and
 * references `merchants.id`. `permissions` is a flat flag set gating surfaces
 * within that merchant (no cross-merchant access). Password hashes are argon2id
 * strings. No `version` column — user edits are rare and last-writer-wins is
 * acceptable.
 */
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    permissions: text("permissions").array().notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("users_email_idx").on(table.email),
    index("users_merchant_idx").on(table.merchantId),
  ],
);

/**
 * Server-side sessions backing the dashboard's session cookie. `csrfToken` is the
 * double-submit token mirrored in the `mayarin_csrf` cookie. `revokedAt` marks a
 * logged-out session; `expiresAt` is the hard expiry the session service checks.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    csrfToken: text("csrf_token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (table) => [
    index("sessions_user_idx").on(table.userId),
    index("sessions_expires_idx").on(table.expiresAt),
  ],
);

/**
 * Catalog products (#10).
 *
 * `merchant_id` carries no foreign key, matching `payment_intents.merchant_id`:
 * merchant ids on the payment side are denormalised snapshots and need not
 * exist as account rows.
 */
export const products = pgTable(
  "products",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id").notNull(),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    active: boolean("active").notNull(),
    metadata: jsonb("metadata").$type<Record<string, string>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
    version: integer("version").notNull(),
  },
  (table) => [
    uniqueIndex("products_merchant_sku_idx").on(table.merchantId, table.sku),
    index("products_merchant_idx").on(table.merchantId, table.createdAt),
  ],
);

/**
 * A product's price in one currency.
 *
 * Its own table rather than a JSON column so every amount stays an exact
 * `numeric(78, 0)` count of minor units, the same as money everywhere else. The
 * unique index is what makes "one price per currency" a database fact rather
 * than a hope.
 */
export const productPrices = pgTable(
  "product_prices",
  {
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    asset: text("asset").notNull(),
    amount: minorUnits("amount").notNull(),
  },
  (table) => [primaryKey({ columns: [table.productId, table.asset] })],
);

/**
 * Payment links (#10) — templates that mint Payment Intents.
 *
 * A link holds no payment state of its own: `disabled_at` and `expires_at`
 * decide only whether another intent may be minted. The intents it produced
 * carry the payments.
 */
export const paymentLinks = pgTable(
  "payment_links",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),

    merchantId: text("merchant_id").notNull(),
    merchantName: text("merchant_name").notNull(),
    merchantCity: text("merchant_city").notNull(),
    merchantCountryCode: text("merchant_country_code").notNull(),
    merchantCategoryCode: text("merchant_category_code"),

    // Set for a `fixed` link only.
    amount: minorUnits("amount"),
    amountAsset: text("amount_asset"),
    // Set for `open` and `catalog`.
    currency: text("currency"),
    // Set for `catalog`: product references, resolved to a price at checkout.
    lines: jsonb("lines").$type<{ productId: string; quantity: number }[]>(),

    title: text("title"),
    merchantReference: text("merchant_reference"),
    metadata: jsonb("metadata").$type<Record<string, string>>().notNull().default({}),

    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    disabledAt: timestamp("disabled_at", { withTimezone: true, mode: "date" }),
    idempotencyKey: text("idempotency_key"),

    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
    version: integer("version").notNull(),
  },
  (table) => [
    uniqueIndex("payment_links_idempotency_key_idx").on(table.idempotencyKey),
    index("payment_links_merchant_idx").on(table.merchantId, table.createdAt),
  ],
);

/**
 * Append-only record of merchant settings edits (#95).
 *
 * `settlement_address` is where a merchant's money goes, so who changed it and
 * when has to survive the change itself. Nothing in the application updates or
 * deletes a row here.
 */
export const merchantSettingChanges = pgTable(
  "merchant_setting_changes",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    /** The account that made the change. */
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    field: text("field").notNull(),
    previousValue: text("previous_value"),
    nextValue: text("next_value"),
    changedAt: timestamp("changed_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [index("merchant_setting_changes_merchant_idx").on(table.merchantId, table.changedAt)],
);

/**
 * Runtime market configuration (#95).
 *
 * Which stablecoins are admitted, which oracle feed serves a pair, which pool
 * prices a swap. Market facts, not deployment identity — they change far more
 * often than a deploy, and editing `.env` and restarting to admit a stablecoin
 * is not a thing a running payment processor should have to do.
 *
 * `value` is opaque JSON: each key already has a zod schema that parses it out
 * of an environment string, and the same schema parses it back out of here.
 */
export const marketConfig = pgTable("market_config", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  /** Absent for a value seeded from the environment on first boot. */
  updatedBy: text("updated_by"),
});

/**
 * Refunds (#12).
 *
 * A refund is a new transfer, not a reversal, so it gets its own row rather
 * than editing the payment that caused it — `clearing_transactions` is
 * untouched by a refund, and how much came back is derived from these rows.
 * Several partials may exist against one payment; what bounds them is their sum.
 */
export const refunds = pgTable(
  "refunds",
  {
    id: text("id").primaryKey(),
    clearingTransactionId: text("clearing_transaction_id")
      .notNull()
      .references(() => clearingTransactions.id),
    paymentIntentId: text("payment_intent_id")
      .notNull()
      .references(() => paymentIntents.id),
    merchantId: text("merchant_id").notNull(),
    amount: minorUnits("amount").notNull(),
    amountAsset: text("amount_asset").notNull(),
    state: text("state").notNull(),
    reason: text("reason"),
    idempotencyKey: text("idempotency_key"),
    providerReference: text("provider_reference"),
    failureReason: text("failure_reason"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("refunds_idempotency_key_idx").on(table.idempotencyKey),
    index("refunds_clearing_idx").on(table.clearingTransactionId, table.createdAt),
    index("refunds_merchant_idx").on(table.merchantId, table.createdAt),
  ],
);

/** Where one merchant wants webhook deliveries, and the signing secret (RFC #13). */
export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    /** Kept through a rotation so deliveries stay verifiable mid-switch. */
    previousSecret: text("previous_secret"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [index("webhook_endpoints_merchant_idx").on(table.merchantId)],
);

/**
 * Attempt-tracked webhook deliveries, derived from `clearing_events`.
 *
 * `(event_id, endpoint_id)` is unique: re-reading the outbox maps a replayed
 * event onto the delivery it already has instead of creating a second one.
 */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => clearingEvents.id),
    endpointId: text("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id),
    merchantId: text("merchant_id").notNull(),
    /** Frozen at enqueue, so every attempt sends identical bytes. */
    body: text("body").notNull(),
    status: text("status").notNull(),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true, mode: "date" }).notNull(),
    lastStatusCode: integer("last_status_code"),
    lastError: text("last_error"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("webhook_deliveries_event_endpoint_idx").on(table.eventId, table.endpointId),
    index("webhook_deliveries_due_idx").on(table.status, table.nextAttemptAt),
  ],
);

/** The dispatcher's read position in the clearing event log. One row per consumer. */
export const webhookCursors = pgTable("webhook_cursors", {
  consumer: text("consumer").primaryKey(),
  eventId: text("event_id").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
});

/**
 * Wallets a merchant is paid into (#11).
 *
 * `merchants.settlement_address` says *where*; this says *what is known about
 * how it got there*. `verified_at` is the whole point — an address with none is
 * a claim, and a claim is not a basis for signing a payment to it.
 *
 * Unique on `(chain, address)`: two merchants cannot claim one address, which
 * is what stops a verified wallet being re-pointed by whoever asks second.
 */
export const merchantWallets = pgTable(
  "merchant_wallets",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    chain: text("chain").notNull(),
    /** Lowercased on the way in; case is not a way past the guard. */
    address: text("address").notNull(),
    provenance: text("provenance").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "date" }),
    /**
     * What a provisioned wallet's address was derived from — the provider's
     * handle (a Turnkey sub-organization), its signer, and the merchant's own.
     *
     * Written before the wallet is deployed. That is what lets an interrupted
     * provision resume onto the same address instead of deploying a second
     * wallet: the derivation is a function of exactly these three.
     */
    providerRef: text("provider_ref"),
    providerSigner: text("provider_signer"),
    merchantSigner: text("merchant_signer"),
    /**
     * The provider handle for a key the *merchant* holds — a Turnkey
     * sub-organization whose only root user is their passkey.
     *
     * Deliberately not `provider_ref`, which means the opposite: that column is
     * the sub-organization Mayarin is root of. Reusing one column for both would
     * make "whose organization is this" a question about which sibling columns
     * happen to be null.
     */
    keyRef: text("key_ref"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("merchant_wallets_address_idx").on(table.chain, table.address),
    index("merchant_wallets_merchant_idx").on(table.merchantId),
    // One managed wallet per merchant per chain. The provisioner checks first,
    // but two concurrent requests both read "none" — this is what makes the
    // second fail rather than deploy a second smart account.
    uniqueIndex("merchant_wallets_managed_idx")
      .on(table.merchantId, table.chain)
      .where(sql`${table.provenance} = 'provisioned'`),
  ],
);

/**
 * Outstanding proofs of control (#11).
 *
 * Consumed on use, so one signature proves control exactly once — a captured
 * signature cannot be replayed after a wallet is unlinked and the address is
 * claimed by someone else.
 */
export const walletChallenges = pgTable("wallet_challenges", {
  id: text("id").primaryKey(),
  merchantId: text("merchant_id")
    .notNull()
    .references(() => merchants.id),
  chain: text("chain").notNull(),
  address: text("address").notNull(),
  nonce: text("nonce").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "date" }),
  createdAt: createdAt(),
});

export const schema = {
  paymentIntents,
  clearingTransactions,
  clearingEvents,
  ledgerAccounts,
  ledgerTransactions,
  ledgerEntries,
  depositAddresses,
  chainDeposits,
  watcherCursors,
  merchants,
  users,
  sessions,
  products,
  productPrices,
  paymentLinks,
  merchantSettingChanges,
  marketConfig,
  refunds,
  merchantWallets,
  walletChallenges,
  webhookEndpoints,
  webhookDeliveries,
  webhookCursors,
};
