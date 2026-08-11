-- Invoices (#112): the document, and the counter that numbers it (migration 0023).
--
-- Written by hand for the same reason `0011_commerce_layer` was:
-- `0009_scaled_rate` was added to the journal without a matching
-- `meta/0009_snapshot.json`, so drizzle-kit cannot diff from the current schema
-- and re-proposes 0009's rename. Regenerating that snapshot is a repo-wide fix,
-- not this change's business.
--
-- `merchant_id` carries no foreign key here, matching `products` and
-- `payment_links`: merchant ids on the payment side are denormalised snapshots
-- and need not exist as account rows.

-- An invoice is a document, so these columns hold what it SAID, not what is
-- currently true. The buyer is flattened as a snapshot for the same reason the
-- merchant is, and line prices are frozen into `lines` rather than read back
-- from `products` at payment time.
--
-- Only 'draft', 'issued' and 'void' are stored. Paid, partly paid and overdue
-- derive from the intents carrying `number` as their merchant reference, so no
-- column here can disagree with the ledger.
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"merchant_name" text NOT NULL,
	"merchant_city" text NOT NULL,
	"merchant_country_code" text NOT NULL,
	"merchant_category_code" text,
	"number" text,
	"sequence" integer,
	"state" text NOT NULL,
	"buyer_name" text NOT NULL,
	"buyer_email" text,
	"buyer_tax_id" text,
	"buyer_address" text,
	"currency" text NOT NULL,
	"lines" jsonb NOT NULL,
	"total" numeric(78, 0) NOT NULL,
	"total_asset" text NOT NULL,
	"notes" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"issued_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"idempotency_key" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_idempotency_key_idx" ON "invoices" USING btree ("idempotency_key");
--> statement-breakpoint
-- The database, not the allocator, is the last word on a number being used
-- once. An allocator bug must surface as a failed write, never as two invoices
-- sharing a number. Drafts hold NULL, and Postgres does not treat two NULLs as
-- equal, so any number of drafts coexist under this index.
CREATE UNIQUE INDEX "invoices_number_idx" ON "invoices" USING btree ("merchant_id","number");
--> statement-breakpoint
CREATE INDEX "invoices_merchant_idx" ON "invoices" USING btree ("merchant_id","created_at");
--> statement-breakpoint

-- The per-merchant invoice number counter.
--
-- A table rather than a Postgres sequence, because a sequence cannot be
-- gapless: `nextval` hands out a value outside transaction control, so a
-- rollback skips one. Accounting expects an unbroken series per merchant, and
-- an auditor reading a hole in one asks what was deleted.
--
-- The row is incremented inside the issuing transaction and holds a row lock
-- for its duration, which serialises issuance for that one merchant. Issuance
-- is a human-rate action, so the contention is one merchant clicking twice,
-- not a throughput ceiling.
CREATE TABLE "invoice_counters" (
	"merchant_id" text PRIMARY KEY NOT NULL,
	"next_number" integer NOT NULL
);
