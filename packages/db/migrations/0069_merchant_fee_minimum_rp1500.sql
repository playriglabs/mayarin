-- A new merchant starts at a 0.08 fee minimum, about Rp 1.500.
-- Only the column default changes: merchants that already exist keep the minimum they have.
ALTER TABLE "merchants" ALTER COLUMN "fee_minimum" SET DEFAULT '0.08';
