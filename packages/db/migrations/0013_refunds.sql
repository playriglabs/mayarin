-- Refunds (#12).
--
-- A refund is a new transfer, not a reversal: `clearing_transactions` is
-- untouched by one, and how much of a payment came back is derived from these
-- rows. Several partials may exist against one payment; what bounds them is
-- their sum, which is a rule the service enforces because SQL cannot express
-- "the sum of siblings" as a constraint.
--
-- Written by hand for the same reason `0010_audit_merchant_index` was:
-- `0009_scaled_rate` was added to the journal without a matching
-- `meta/0009_snapshot.json`, so drizzle-kit cannot diff from the current schema.
--
-- Numbered 0013: 0011 (commerce layer) and 0012 (runtime config) are in flight
-- on other branches. None of the three touch a common table.
CREATE TABLE "refunds" (
	"id" text PRIMARY KEY NOT NULL,
	"clearing_transaction_id" text NOT NULL,
	"payment_intent_id" text NOT NULL,
	"merchant_id" text NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"amount_asset" text NOT NULL,
	"state" text NOT NULL,
	"reason" text,
	"idempotency_key" text,
	"provider_reference" text,
	"failure_reason" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_clearing_transaction_id_clearing_transactions_id_fk" FOREIGN KEY ("clearing_transaction_id") REFERENCES "public"."clearing_transactions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_intent_id_payment_intents_id_fk" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_idempotency_key_idx" ON "refunds" USING btree ("idempotency_key");
--> statement-breakpoint
CREATE INDEX "refunds_clearing_idx" ON "refunds" USING btree ("clearing_transaction_id","created_at");
--> statement-breakpoint
CREATE INDEX "refunds_merchant_idx" ON "refunds" USING btree ("merchant_id","created_at");
