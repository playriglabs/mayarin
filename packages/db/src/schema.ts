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

    rateFrom: text("rate_from"),
    rateTo: text("rate_to"),
    rateMinorUnitsPerWholeUnit: minorUnits("rate_minor_units_per_whole_unit"),
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
    depositRateMinorUnitsPerWholeUnit: minorUnits("deposit_rate_minor_units_per_whole_unit"),
    depositRateSource: text("deposit_rate_source"),
    depositRateLockedAt: timestamp("deposit_rate_locked_at", { withTimezone: true, mode: "date" }),
    depositRateExpiresAt: timestamp("deposit_rate_expires_at", {
      withTimezone: true,
      mode: "date",
    }),

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
};
