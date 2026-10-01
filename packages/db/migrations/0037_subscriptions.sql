-- Subscriptions (#296): recurring billing, send-to-pay.
--
-- The schedule (anchor, interval, cycles billed) and the lifecycle state. The
-- next billing date is derived from the anchor on every read, never stored,
-- so month-end clamping cannot drift. Each billed cycle is an ordinary invoice
-- carrying `metadata.subscriptionId`; no cycle table is needed.
--
-- Written by hand like every migration since 0009: drizzle-kit's snapshot
-- chain ends at 0008 and otherwise re-proposes 0009's settled rate rename.
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"subscriber_name" text NOT NULL,
	"subscriber_email" text,
	"description" text NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"asset" text NOT NULL,
	"interval" text NOT NULL,
	"anchor_at" timestamp with time zone NOT NULL,
	"billed_cycles" integer NOT NULL,
	"days_until_due" integer NOT NULL,
	"state" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	"version" integer NOT NULL,
	CONSTRAINT "subscriptions_merchant_id_merchants_id_fk"
		FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id")
		ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "subscriptions_merchant_idx"
	ON "subscriptions" USING btree ("merchant_id", "created_at");
--> statement-breakpoint
CREATE INDEX "subscriptions_state_idx"
	ON "subscriptions" USING btree ("state", "created_at");
