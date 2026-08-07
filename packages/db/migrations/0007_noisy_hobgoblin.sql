ALTER TABLE "clearing_transactions" ADD COLUMN "contract_intent_id" text;--> statement-breakpoint
ALTER TABLE "clearing_transactions" ADD COLUMN "contract_settlement_token" text;--> statement-breakpoint
ALTER TABLE "clearing_transactions" ADD COLUMN "contract_min_out" numeric(78, 0);--> statement-breakpoint
ALTER TABLE "clearing_transactions" ADD COLUMN "contract_fee" numeric(78, 0);--> statement-breakpoint
ALTER TABLE "clearing_transactions" ADD COLUMN "contract_merchant_safe" text;--> statement-breakpoint
ALTER TABLE "clearing_transactions" ADD COLUMN "contract_refund_to" text;--> statement-breakpoint
ALTER TABLE "clearing_transactions" ADD COLUMN "contract_deadline" numeric(78, 0);--> statement-breakpoint
ALTER TABLE "clearing_transactions" ADD COLUMN "contract_signature" text;--> statement-breakpoint
ALTER TABLE "clearing_transactions" ADD COLUMN "contract_signer" text;--> statement-breakpoint
ALTER TABLE "clearing_transactions" ADD COLUMN "contract_payer_estimate" numeric(78, 0);--> statement-breakpoint
ALTER TABLE "clearing_transactions" ADD COLUMN "contract_payer_asset" text;--> statement-breakpoint
ALTER TABLE "clearing_transactions" ADD COLUMN "contract_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clearing_transactions" ADD COLUMN "contract_tx_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "clearing_transactions_contract_intent_idx" ON "clearing_transactions" USING btree ("contract_intent_id");