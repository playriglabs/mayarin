-- The method's own mark, kept with the funding it belongs to.
--
-- TransFi ships a logo URL with every payment method, but the URL is not
-- derivable from the method code: most are `<code>.svg`, and a quarter are not
-- (`ph_paymaya` is `paymaya.svg`, `cimb_my_fpx` is `by.svg`). So it is stored as
-- the provider gave it when the order was opened, not rebuilt later.
--
-- Rows written before this column existed are backfilled only where the code
-- is known to follow the pattern; the rest stay null and are drawn without a mark.
--
-- Written by hand like every migration since 0009.
ALTER TABLE "payment_fundings" ADD COLUMN "payment_logo_url" text;
--> statement-breakpoint
UPDATE "payment_fundings"
SET "payment_logo_url" =
  'https://prd-tf-common-payment-methods-logo.s3.ap-southeast-1.amazonaws.com/' || "payment_code" || '.svg'
WHERE "provider" = 'transfi'
  AND "payment_code" NOT IN (
    'agrobank_fpx', 'ambank_fpx', 'bank_islam_fpx', 'bank_muamalat_fpx', 'bank_of_china_fpx',
    'bsi', 'cimb', 'cimb_my_fpx', 'hong_leong_fpx', 'kfh_fpx', 'maybank_id', 'maybank_my_fpx',
    'my_shopee', 'ocbc_fpx', 'ph_grabpay', 'ph_paymaya', 'ph_shopee', 'public_bank_fpx',
    'rhb_fpx', 'shopeepay'
  );
