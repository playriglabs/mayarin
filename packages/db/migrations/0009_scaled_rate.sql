-- A rate is no longer one integer per whole source unit; it now carries
-- RATE_DECIMALS (9) fractional digits. `IDR/USDC` sits near 56, so the old
-- representation rounded ~19 bps away on every IDR-priced payment — more than a
-- third of the fee. The columns are renamed because their previous names
-- describe a unit they no longer hold.
--
-- `numeric(78, 0)` already has the range for the extra nine digits, so only the
-- names change. Any row written before this migration holds an unscaled rate
-- and would read 10^9 times too small; there is no production data to convert,
-- and inventing a multiply-by-10^9 backfill would silently corrupt any row that
-- had already been written the new way.
ALTER TABLE "clearing_transactions" RENAME COLUMN "rate_minor_units_per_whole_unit" TO "rate_scaled";
--> statement-breakpoint
ALTER TABLE "clearing_transactions" RENAME COLUMN "deposit_rate_minor_units_per_whole_unit" TO "deposit_rate_scaled";
