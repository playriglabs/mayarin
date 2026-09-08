-- Agent-payable obligations (#273): the opt-in listing flags, and the quote
-- lock that stands between a payable 402 and its settle.
--
-- `listed` is false by default on all three registries. Listing is consent:
-- today's requirement to name a merchant in the discovery query is accidental
-- privacy some merchants are relying on without knowing it, so an index that
-- relaxes it must start from nothing listed and let each merchant opt in.
--
-- `x402_payable_quotes` holds one live row per payable obligation. A resource's
-- price is static registry config, so the registry row itself is the price lock;
-- an invoice's outstanding balance moves as payments land, so the lock has to be
-- a row of its own — the amount that was quoted, the rails exactly as they were
-- offered when it was (the payer signs against them), and the EIP-3009 nonce
-- claim that makes two agents racing one obligation refuse rather than
-- double-pay. No postgres enums, matching every other variant set in this
-- schema: text plus a CHECK constraint, validated on read by the adapter.
--
-- Written by hand like every migration since 0009: drizzle-kit's snapshot chain
-- ends at 0008 and otherwise re-proposes 0009's settled rate rename.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "listed" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN IF NOT EXISTS "listed" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "x402_resources" ADD COLUMN IF NOT EXISTS "listed" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE INDEX "invoices_listed_idx" ON "invoices" USING btree ("listed", "created_at");
--> statement-breakpoint
CREATE INDEX "payment_links_listed_idx" ON "payment_links" USING btree ("listed", "created_at");
--> statement-breakpoint
CREATE INDEX "x402_resources_listed_idx" ON "x402_resources" USING btree ("listed", "created_at");
--> statement-breakpoint
CREATE TABLE "x402_payable_quotes" (
	"kind" text NOT NULL,
	"obligation_id" text NOT NULL,
	"merchant_id" text NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"asset" text NOT NULL,
	"accepts" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"claimed_nonce" text,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "x402_payable_quotes_pkey" PRIMARY KEY ("kind", "obligation_id"),
	CONSTRAINT "x402_payable_quotes_kind_check" CHECK ("kind" IN ('invoice', 'link')),
	CONSTRAINT "x402_payable_quotes_status_check" CHECK ("status" IN ('quoted', 'claimed', 'settled'))
);
--> statement-breakpoint
CREATE INDEX "x402_payable_quotes_merchant_idx"
	ON "x402_payable_quotes" USING btree ("merchant_id", "created_at");