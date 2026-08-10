-- Merchant profile: city and country (#15).
--
-- Every Payment Intent freezes a merchant snapshot, and that snapshot has always
-- carried `city` and `countryCode` — an EMVCo QR has a fixed tag for each. Until
-- now the only source for them was the request body, so whoever called the
-- payment API had to supply them on every call. That is workable for an SDK
-- consumer and impossible for a dashboard, where the merchant minting a payment
-- link IS the merchant and should not be typing their own city into each link.
--
-- Nullable rather than defaulted: inventing "Jakarta" for every existing row
-- would put a fact on the record that nobody asserted, and this value is shown
-- to buyers. A merchant with these unset simply cannot mint a link until they
-- fill them in, which the settings surface asks for and the link route refuses
-- without.
--
-- Written by hand, like 0009 onward.
ALTER TABLE "merchants" ADD COLUMN "city" text;
--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "country_code" text;
