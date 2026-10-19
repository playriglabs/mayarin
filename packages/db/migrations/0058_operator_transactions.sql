-- What the operator key sent under each nonce (SEC-04).
--
-- The nonce sequencer hands out nonces; this is the record of what was done with
-- each. Written when a nonce is allocated and again when the node accepts the
-- broadcast, closed by the chain worker's reconciler once the chain settles it.
-- Written by hand like every migration since 0009.
CREATE TABLE "operator_transactions" (
  "id" text PRIMARY KEY NOT NULL,
  "key" text NOT NULL,
  "nonce" integer NOT NULL,
  "status" text NOT NULL,
  "tx_hash" text,
  "allocated_at" timestamp with time zone NOT NULL,
  "submitted_at" timestamp with time zone,
  "resolved_at" timestamp with time zone,
  CONSTRAINT "operator_transactions_status_check" CHECK ("status" IN ('allocated', 'submitted', 'finalized', 'reverted', 'replaced', 'abandoned'))
);
--> statement-breakpoint
CREATE INDEX "operator_transactions_status_idx" ON "operator_transactions" ("status");
