-- Where each merchant is paid on-chain — the signed order's `merchantSafe`.
--
-- Nullable: a merchant who settles off-chain never needs one. The
-- on-chain-contract path refuses to lock without it rather than falling back to
-- a deployment-wide address, which is what this replaces — one configured
-- address paid every merchant on the deployment into the same wallet.
ALTER TABLE "merchants" ADD COLUMN "settlement_address" text;
