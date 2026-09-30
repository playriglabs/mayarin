-- A payout batch is paid from the managed Safe or, since #295's wallet source,
-- straight from any wallet the merchant connects. The column names where the
-- money left either way.
--
-- Written by hand like every migration since 0009: drizzle-kit's snapshot
-- chain ends at 0008 and otherwise re-proposes 0009's settled rate rename.
ALTER TABLE "payout_batches" RENAME COLUMN "safe_address" TO "source_address";
