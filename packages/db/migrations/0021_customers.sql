-- Merchant-managed customer directory.
--
-- Commerce, like `products`: the merchant knows who their customers are,
-- Mayarin does not. A payer's wallet address is not stored on the intent (the
-- deposit-match path has no use for it), so a customer is a merchant-managed
-- record rather than something derived from on-chain activity. A payment links
-- to one through `metadata.customerId` stamped at intent creation.
--
-- One customer per email per merchant. Postgres treats NULL as distinct in a
-- unique index, so a merchant with several walk-up customers known only by name
-- (no email) is unconstrained — they do not need to invent an email to save a
-- contact.
--
-- Written by hand, like 0009 onward.
CREATE TABLE IF NOT EXISTS "customers" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL REFERENCES "merchants"("id"),
	"name" text NOT NULL,
	"email" text,
	"notes" text,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customers_merchant_idx" ON "customers" ("merchant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "customers_merchant_email_idx" ON "customers" ("merchant_id", "email");