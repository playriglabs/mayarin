CREATE TABLE "clearing_events" (
	"id" text PRIMARY KEY NOT NULL,
	"clearing_transaction_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"type" text NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clearing_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_intent_id" text NOT NULL,
	"state" text NOT NULL,
	"merchant_id" text NOT NULL,
	"merchant_name" text NOT NULL,
	"merchant_city" text NOT NULL,
	"merchant_country_code" text NOT NULL,
	"source_amount" numeric(78, 0) NOT NULL,
	"source_asset" text NOT NULL,
	"settlement_asset" text NOT NULL,
	"provider" text NOT NULL,
	"rate_from" text,
	"rate_to" text,
	"rate_minor_units_per_whole_unit" numeric(78, 0),
	"rate_source" text,
	"rate_locked_at" timestamp with time zone,
	"rate_expires_at" timestamp with time zone,
	"settlement_amount" numeric(78, 0),
	"fee_amount" numeric(78, 0),
	"net_amount" numeric(78, 0),
	"provider_reference" text,
	"failure_reason" text,
	"failure_code" text,
	"failure_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"asset" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"transaction_id" text NOT NULL,
	"account_id" text NOT NULL,
	"account_code" text NOT NULL,
	"direction" text NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"asset" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"reference" text,
	"idempotency_key" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"merchant_id" text NOT NULL,
	"merchant_name" text NOT NULL,
	"merchant_city" text NOT NULL,
	"merchant_country_code" text NOT NULL,
	"merchant_category_code" text,
	"amount" numeric(78, 0) NOT NULL,
	"amount_asset" text NOT NULL,
	"settlement_asset" text NOT NULL,
	"provider" text NOT NULL,
	"source_type" text NOT NULL,
	"source_scheme" text,
	"source_payload" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text,
	"request_fingerprint" text,
	"clearing_transaction_id" text,
	"failure_reason" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"version" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clearing_events" ADD CONSTRAINT "clearing_events_clearing_transaction_id_clearing_transactions_id_fk" FOREIGN KEY ("clearing_transaction_id") REFERENCES "public"."clearing_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clearing_transactions" ADD CONSTRAINT "clearing_transactions_payment_intent_id_payment_intents_id_fk" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clearing_events_sequence_idx" ON "clearing_events" USING btree ("clearing_transaction_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "clearing_transactions_payment_intent_idx" ON "clearing_transactions" USING btree ("payment_intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clearing_transactions_provider_reference_idx" ON "clearing_transactions" USING btree ("provider","provider_reference");--> statement-breakpoint
CREATE INDEX "clearing_transactions_state_idx" ON "clearing_transactions" USING btree ("state","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_code_idx" ON "ledger_accounts" USING btree ("code");--> statement-breakpoint
CREATE INDEX "ledger_entries_account_idx" ON "ledger_entries" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_transaction_idx" ON "ledger_entries" USING btree ("transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_transactions_idempotency_key_idx" ON "ledger_transactions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "ledger_transactions_reference_idx" ON "ledger_transactions" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_intents_idempotency_key_idx" ON "payment_intents" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "payment_intents_merchant_idx" ON "payment_intents" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "payment_intents_status_idx" ON "payment_intents" USING btree ("status");