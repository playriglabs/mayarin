-- The payer signs the contract payment; preserve its address across reloads.
ALTER TABLE "payment_intents" ADD COLUMN "payer_address" text;
