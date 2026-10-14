-- The chain a payment funded in a local currency is delivered to.
--
-- A payer who pays a rupiah QR does not pick a network. TransFi delivers the
-- stablecoin to one chain, and which one is the merchant's decision. Null is "the
-- deployment's rule": the merchant's own settlement asset first, then the
-- cheapest chain the provider supports. No default and no backfill — every
-- existing merchant keeps behaving as they do now.
--
-- Written by hand like every migration since 0009.
ALTER TABLE "merchants" ADD COLUMN "local_currency_chain" text;
