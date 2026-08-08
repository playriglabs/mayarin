-- Managed wallet provisioning (#11).
--
-- A provisioned wallet's address is derived from its signer set: the merchant's
-- own verified address and the provider's. These three columns record that
-- derivation, and they are written *before* the wallet is deployed.
--
-- That ordering is the whole point. Provisioning is three effects — create the
-- provider's signer, deploy the wallet, record it — and a crash between any two
-- must leave the merchant with exactly one wallet. Zero is a failure somebody
-- notices; two is a second address a payer might be told to pay into, and
-- nobody notices until the money is in the wrong one. With the derivation on
-- file, a resumed attempt re-derives the same address and adopts what is
-- already there.
--
-- Nullable because a `linked` wallet has no provider behind it: the merchant
-- brought the address and Mayarin signs nothing on its behalf. A merchant can
-- hold both kinds on one chain at once, which is connect-existing living
-- alongside managed rather than being replaced by it.
--
-- Written by hand for the same reason as 0016.
ALTER TABLE "merchant_wallets" ADD COLUMN "provider_ref" text;--> statement-breakpoint
ALTER TABLE "merchant_wallets" ADD COLUMN "provider_signer" text;--> statement-breakpoint
ALTER TABLE "merchant_wallets" ADD COLUMN "merchant_signer" text;--> statement-breakpoint

-- One managed wallet per merchant per chain, enforced where it cannot be raced.
-- The application checks for an existing one before provisioning, but two
-- concurrent requests both read "none" and both proceed; this is what makes the
-- second one fail instead of deploying a second Safe.
CREATE UNIQUE INDEX "merchant_wallets_managed_idx" ON "merchant_wallets" USING btree ("merchant_id","chain") WHERE "provenance" = 'provisioned';
