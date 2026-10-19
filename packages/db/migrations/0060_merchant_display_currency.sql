-- The currency a merchant reads their balance and analytics in.
--
-- Display only: nothing is priced, locked or settled in it. Null is "US dollars",
-- so every existing merchant keeps seeing what they see now. ISO 4217 alpha-3,
-- uppercase, checked by the application against the rates it can read.
ALTER TABLE "merchants" ADD COLUMN "display_currency" text;
