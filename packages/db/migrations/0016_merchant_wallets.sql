-- Merchant wallets and proofs of control (#11).
--
-- `merchants.settlement_address` says where a merchant is paid. Nothing has
-- ever said what is known about how that address got there — and since #95 the
-- field is writable through an authenticated API, so an account with
-- `settings:manage` could name any address and have an order signed paying into
-- it. `verified_at` is what lets the order signer refuse.
--
-- Deliberately no backfill. Existing settlement addresses are not marked
-- verified: nobody has proved control of them, and writing that down would make
-- the column mean nothing on its first day. Merchants on the contract path
-- verify once, and payments resume.
--
-- Numbered 0016, skipping 0015, which is in flight on another branch (#121).
-- Neither touches a common table.
--
-- Written by hand for the same reason as 0010: the journal carries 0009/0010
-- without matching snapshots, so drizzle-kit cannot diff from the current
-- schema without re-proposing their changes.
CREATE TABLE "merchant_wallets" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"chain" text NOT NULL,
	"address" text NOT NULL,
	"provenance" text NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "merchant_wallets" ADD CONSTRAINT "merchant_wallets_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Two merchants cannot claim one address: without this, a verified wallet is
-- re-pointable by whoever asks second.
CREATE UNIQUE INDEX "merchant_wallets_address_idx" ON "merchant_wallets" USING btree ("chain","address");
--> statement-breakpoint
CREATE INDEX "merchant_wallets_merchant_idx" ON "merchant_wallets" USING btree ("merchant_id");
--> statement-breakpoint

CREATE TABLE "wallet_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"chain" text NOT NULL,
	"address" text NOT NULL,
	"nonce" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wallet_challenges" ADD CONSTRAINT "wallet_challenges_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;
