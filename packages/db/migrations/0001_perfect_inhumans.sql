CREATE TABLE "chain_deposits" (
	"id" text PRIMARY KEY NOT NULL,
	"chain" text NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"address" text NOT NULL,
	"asset" text NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"block_number" numeric(78, 0) NOT NULL,
	"block_hash" text NOT NULL,
	"status" text NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"orphaned_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "deposit_addresses" (
	"id" text PRIMARY KEY NOT NULL,
	"clearing_transaction_id" text NOT NULL,
	"derivation_index" integer NOT NULL,
	"chain" text NOT NULL,
	"asset" text NOT NULL,
	"address" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watcher_cursors" (
	"chain" text NOT NULL,
	"asset" text NOT NULL,
	"last_block" numeric(78, 0) NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "watcher_cursors_chain_asset_pk" PRIMARY KEY("chain","asset")
);
--> statement-breakpoint
ALTER TABLE "clearing_transactions" ADD COLUMN "deposit_asset" text;--> statement-breakpoint
ALTER TABLE "clearing_transactions" ADD COLUMN "deposit_chain" text;--> statement-breakpoint
ALTER TABLE "clearing_transactions" ADD COLUMN "deposit_address" text;--> statement-breakpoint
ALTER TABLE "clearing_transactions" ADD COLUMN "deposit_amount" numeric(78, 0);--> statement-breakpoint
ALTER TABLE "clearing_transactions" ADD COLUMN "deposit_rate_minor_units_per_whole_unit" numeric(78, 0);--> statement-breakpoint
ALTER TABLE "clearing_transactions" ADD COLUMN "deposit_rate_source" text;--> statement-breakpoint
ALTER TABLE "clearing_transactions" ADD COLUMN "deposit_rate_locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clearing_transactions" ADD COLUMN "deposit_rate_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD COLUMN "payment_asset" text;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD COLUMN "payment_chain" text;--> statement-breakpoint
ALTER TABLE "deposit_addresses" ADD CONSTRAINT "deposit_addresses_clearing_transaction_id_clearing_transactions_id_fk" FOREIGN KEY ("clearing_transaction_id") REFERENCES "public"."clearing_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chain_deposits_log_idx" ON "chain_deposits" USING btree ("chain","tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "chain_deposits_address_idx" ON "chain_deposits" USING btree ("chain","address");--> statement-breakpoint
CREATE INDEX "chain_deposits_status_idx" ON "chain_deposits" USING btree ("chain","status","block_number");--> statement-breakpoint
CREATE UNIQUE INDEX "deposit_addresses_clearing_idx" ON "deposit_addresses" USING btree ("clearing_transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deposit_addresses_address_idx" ON "deposit_addresses" USING btree ("chain","address");--> statement-breakpoint
CREATE UNIQUE INDEX "deposit_addresses_index_idx" ON "deposit_addresses" USING btree ("derivation_index");--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS "deposit_address_index_seq" START 1;