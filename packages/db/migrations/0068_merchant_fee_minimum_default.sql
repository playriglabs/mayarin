-- A new merchant starts at a 0.05 fee minimum instead of 0.10.
-- Only the column default changes: merchants that already exist keep the minimum they have.
ALTER TABLE "merchants" ALTER COLUMN "fee_minimum" SET DEFAULT '0.05';
