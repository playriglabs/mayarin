-- Where a failed deposit is sent back to: an address the payer names on the rail.
-- Separate from payer_address, which turns on buyer protection when the merchant offers it.
-- Written by hand like every migration since 0009.
ALTER TABLE "payment_intents"
  ADD COLUMN "return_address" text;
