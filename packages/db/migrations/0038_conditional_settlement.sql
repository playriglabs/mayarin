-- Conditional settlement (#304): the escrow an intent asks for, the terms the
-- signed order's escrow address was derived from, and the merchant's
-- buyer-protection default.
ALTER TABLE "payment_intents" ADD COLUMN "escrow" jsonb;--> statement-breakpoint
ALTER TABLE "clearing_transactions" ADD COLUMN "contract_escrow" jsonb;--> statement-breakpoint
ALTER TABLE "clearing_transactions" ADD COLUMN "escrow_outcome" text;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "buyer_protection" jsonb;
