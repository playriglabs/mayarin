CREATE TABLE "settlement_events" (
	"id" text PRIMARY KEY NOT NULL,
	"chain" text NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" numeric(78, 0) NOT NULL,
	"block_hash" text NOT NULL,
	"intent_id" text NOT NULL,
	"merchant_safe" text NOT NULL,
	"settled_amount" numeric(78, 0) NOT NULL,
	"fee" numeric(78, 0) NOT NULL,
	"refund_amount" numeric(78, 0) NOT NULL,
	"status" text NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"orphaned_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_events_log_idx" ON "settlement_events" USING btree ("chain","tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "settlement_events_intent_idx" ON "settlement_events" USING btree ("intent_id");--> statement-breakpoint
CREATE INDEX "settlement_events_probe_idx" ON "settlement_events" USING btree ("chain","status","block_number");