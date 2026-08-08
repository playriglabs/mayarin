-- Webhook notifications (RFC #13). Three tables: where a merchant wants to be
-- told (`webhook_endpoints`), one attempt-tracked delivery per event and
-- endpoint (`webhook_deliveries`), and the dispatcher's read position in the
-- clearing event log (`webhook_cursors`). Deliveries are unique on
-- `(event_id, endpoint_id)` so a re-read of the outbox maps a replayed event
-- onto the delivery it already has.
--
-- Written by hand for the same reason as 0010: the journal carries 0009/0010
-- without matching snapshots, so drizzle-kit cannot diff from the current
-- schema without re-proposing their changes.
--
-- Renumbered 0011 -> 0014 on rebase: 0011 (commerce), 0012 (runtime config) and
-- 0013 (refunds) landed on main while this branch was open. None of the four
-- touch a common table.
CREATE TABLE "webhook_endpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"previous_secret" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"endpoint_id" text NOT NULL,
	"merchant_id" text NOT NULL,
	"body" text NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"last_status_code" integer,
	"last_error" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_cursors" (
	"consumer" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_event_id_clearing_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."clearing_events"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "webhook_endpoints_merchant_idx" ON "webhook_endpoints" USING btree ("merchant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_event_endpoint_idx" ON "webhook_deliveries" USING btree ("event_id","endpoint_id");
--> statement-breakpoint
CREATE INDEX "webhook_deliveries_due_idx" ON "webhook_deliveries" USING btree ("status","next_attempt_at");
