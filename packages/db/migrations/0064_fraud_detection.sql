-- Fraud detection (FDS): what the rules found on a payment, and the addresses
-- nobody may pay from. Written by hand like every migration since 0009.
CREATE TABLE "risk_assessments" (
  "id" text PRIMARY KEY NOT NULL,
  "payment_intent_id" text NOT NULL,
  "merchant_id" text NOT NULL,
  "payer" text,
  "outcome" text NOT NULL,
  "signals" jsonb NOT NULL,
  "assessed_at" timestamp with time zone NOT NULL,
  CONSTRAINT "risk_assessments_outcome_check" CHECK ("outcome" IN ('CLEAR', 'REVIEW', 'BLOCKED'))
);
--> statement-breakpoint
CREATE INDEX "risk_assessments_merchant_time_idx" ON "risk_assessments" ("merchant_id", "assessed_at");
--> statement-breakpoint
CREATE INDEX "risk_assessments_intent_idx" ON "risk_assessments" ("payment_intent_id");
--> statement-breakpoint
CREATE TABLE "address_denylist" (
  "address" text PRIMARY KEY NOT NULL,
  "reason" text NOT NULL,
  "added_at" timestamp with time zone NOT NULL
);
