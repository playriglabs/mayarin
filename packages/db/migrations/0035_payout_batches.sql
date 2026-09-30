-- Batch payouts (#295): one row per batch the chain confirmed.
--
-- Append-only. The dashboard API writes a row only after the transaction's own
-- ERC-20 `Transfer` logs matched every row the merchant listed, so a hash here
-- is money that left the Safe exactly as listed. Rows are one jsonb array: a
-- batch is read whole and never queried by recipient.
--
-- Written by hand like every migration since 0009: drizzle-kit's snapshot
-- chain ends at 0008 and otherwise re-proposes 0009's settled rate rename.
CREATE TABLE "payout_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"chain" text NOT NULL,
	"safe_address" text NOT NULL,
	"submitted_by" text NOT NULL,
	"transaction_hash" text NOT NULL,
	"rows" jsonb NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "payout_batches_merchant_id_merchants_id_fk"
		FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id")
		ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "payout_batches_merchant_idx"
	ON "payout_batches" USING btree ("merchant_id", "completed_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "payout_batches_transaction_idx"
	ON "payout_batches" USING btree ("chain", "transaction_hash");
