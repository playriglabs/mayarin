-- Successful managed-wallet withdrawals.
--
-- Append-only: the provider has already observed a successful transaction
-- receipt before the dashboard API writes one of these rows. Failed attempts
-- therefore never appear as completed history.
--
-- Written by hand like every migration since 0009: drizzle-kit's snapshot
-- chain ends at 0008 and otherwise re-proposes 0009's settled rate rename.
CREATE TABLE "wallet_withdrawals" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"chain" text NOT NULL,
	"wallet_address" text NOT NULL,
	"destination_address" text NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"asset" text NOT NULL,
	"transaction_hash" text NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "wallet_withdrawals_merchant_id_merchants_id_fk"
		FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id")
		ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "wallet_withdrawals_merchant_idx"
	ON "wallet_withdrawals" USING btree ("merchant_id", "completed_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_withdrawals_transaction_idx"
	ON "wallet_withdrawals" USING btree ("chain", "transaction_hash");
