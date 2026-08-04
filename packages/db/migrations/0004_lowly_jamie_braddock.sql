ALTER TABLE "clearing_transactions" ADD COLUMN "execution_path" text;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD COLUMN "execution_path" text;