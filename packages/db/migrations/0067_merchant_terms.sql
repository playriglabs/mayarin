-- The fee and the ceilings a merchant is held to, per merchant instead of per deployment.
--
-- Replaces FEE_BASIS_POINTS, FEE_MINIMUM, MAX_PAYMENT_SETTLEMENT and
-- MAX_MERCHANT_DAILY_SETTLEMENT. Amounts are whole units of the settlement asset.
-- Existing merchants take the defaults. Written by hand like every migration since 0009.
ALTER TABLE "merchants"
  ADD COLUMN "fee_basis_points" integer DEFAULT 50 NOT NULL,
  ADD COLUMN "fee_minimum" text DEFAULT '0.10' NOT NULL,
  ADD COLUMN "max_payment_settlement" text DEFAULT '1000' NOT NULL,
  ADD COLUMN "max_daily_settlement" text DEFAULT '2000' NOT NULL;
