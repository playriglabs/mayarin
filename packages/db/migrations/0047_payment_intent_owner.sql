-- The tenant that owns a payment (SEC-01).
--
-- `merchant_id` is whatever identity the payment names: a Mayarin tenant for a
-- link or an invoice, an EMVCo merchant for a scanned QR. Authorization needs
-- the tenant, so it gets its own column. Every existing row is backfilled from
-- `merchant_id`; a scanned-QR row therefore names an EMVCo identity no API key
-- matches, and is refused rather than guessed at.
--
-- Written by hand like every migration since 0009.
ALTER TABLE "payment_intents" ADD COLUMN "owner_merchant_id" text;
UPDATE "payment_intents" SET "owner_merchant_id" = "merchant_id";
