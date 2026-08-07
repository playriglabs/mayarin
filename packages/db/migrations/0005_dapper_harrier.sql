-- Per-merchant asset policy: what the merchant is paid in, and what a payer may
-- pay them with.
--
-- Both are NOT NULL with no default in the schema, so existing rows are
-- backfilled here and the default is dropped again — a new merchant must state
-- its settlement asset rather than inherit one silently.
--
-- Backfill: USDC settlement (the seed CLI's default), and an empty
-- accepted-assets list, which means "no merchant preference, deployment default
-- stands" rather than "accepts nothing".
ALTER TABLE "merchants" ADD COLUMN "settlement_asset" text NOT NULL DEFAULT 'USDC';--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "accepted_assets" text[] NOT NULL DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "merchants" ALTER COLUMN "settlement_asset" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "merchants" ALTER COLUMN "accepted_assets" DROP DEFAULT;
