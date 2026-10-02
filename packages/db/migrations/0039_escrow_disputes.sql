-- Escrow disputes (#313): the case file beside the on-chain `disputed` flag —
-- parties, deadline and an append-only evidence thread — so an arbiter decides
-- on evidence, and a dispute does not reach the `resolveBy` refund by neglect.
--
-- Written by hand like every migration since 0009.
CREATE TABLE "escrow_disputes" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_intent_id" text NOT NULL,
	"merchant_id" text NOT NULL,
	"chain" text NOT NULL,
	"factory" text NOT NULL,
	"payer" text NOT NULL,
	"payee" text NOT NULL,
	"arbiter" text NOT NULL,
	"release_after" timestamp with time zone NOT NULL,
	"resolve_by" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"decided_at" timestamp with time zone,
	"alerted" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "escrow_disputes_payment_intent_id_payment_intents_id_fk"
		FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id")
		ON DELETE no action ON UPDATE no action,
	CONSTRAINT "escrow_disputes_status_check"
		CHECK ("status" IN ('open', 'released', 'refunded')),
	CONSTRAINT "escrow_disputes_alerted_check"
		CHECK ("alerted" IS NULL OR "alerted" IN ('48h', '24h'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "escrow_disputes_payment_intent_idx"
	ON "escrow_disputes" USING btree ("payment_intent_id");
--> statement-breakpoint
CREATE INDEX "escrow_disputes_open_idx"
	ON "escrow_disputes" USING btree ("status", "resolve_by");
--> statement-breakpoint
CREATE TABLE "escrow_dispute_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"dispute_id" text NOT NULL,
	"author" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "escrow_dispute_messages_dispute_id_escrow_disputes_id_fk"
		FOREIGN KEY ("dispute_id") REFERENCES "public"."escrow_disputes"("id")
		ON DELETE no action ON UPDATE no action,
	CONSTRAINT "escrow_dispute_messages_author_check"
		CHECK ("author" IN ('payer', 'merchant', 'arbiter'))
);
--> statement-breakpoint
CREATE INDEX "escrow_dispute_messages_dispute_idx"
	ON "escrow_dispute_messages" USING btree ("dispute_id", "created_at");
