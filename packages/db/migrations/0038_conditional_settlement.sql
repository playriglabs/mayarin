-- Conditional settlement (#304): the escrow an intent asks for, and the terms
-- the signed order's escrow address was derived from.
ALTER TABLE "payment_intents" ADD COLUMN "escrow" jsonb;--> statement-breakpoint
ALTER TABLE "clearing_transactions" ADD COLUMN "contract_escrow" jsonb;
