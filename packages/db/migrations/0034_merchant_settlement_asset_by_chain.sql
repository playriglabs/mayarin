-- Settlement asset, overridden per chain.
--
-- `settlement_asset` is one asset for every chain, which breaks where a chain
-- has no venue into it: Robinhood and Arbitrum carry USDG with no USDG/USDC pool,
-- so a USDC merchant could never be offered USDG there. A chain present here
-- settles in its own asset; a chain absent keeps `settlement_asset`.
--
-- Defaults to `{}`, so every existing merchant settles exactly as today.
--
-- Written by hand like every migration since 0009: drizzle-kit's snapshot chain
-- ends at 0008 and otherwise re-proposes 0009's settled rate rename.
ALTER TABLE "merchants"
	ADD COLUMN IF NOT EXISTS "settlement_asset_by_chain" jsonb DEFAULT '{}'::jsonb NOT NULL;
