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

import {
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
};
