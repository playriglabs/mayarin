-- Durable records for the internal stablecoin rail (#15).
--
-- The rail has no external provider to ask, so its own record IS the record.
-- It lived in process memory, and the clearing engine asks for it again after
-- the fact — sometimes after a restart. A payment that had settled came back
-- "unknown settlement" and was failed, with the money already moved. Every
-- other participant in that flow was durable; its counterparty was not.
--
-- `idempotency_key` is unique because a replayed settle must return the first
-- reference rather than credit a second time. That guarantee was previously a
-- `Map` that a restart emptied.
--
-- No foreign key to `clearing_transactions`: an adapter is swappable by
-- construction and must not take a hard dependency on the engine's tables. The
-- column is a reference for operators, not a constraint.
--
-- Written by hand, like 0009 onward.
CREATE TABLE IF NOT EXISTS "stablecoin_settlements" (
	"provider_reference" text PRIMARY KEY NOT NULL,
	"clearing_transaction_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"state" text NOT NULL,
	"amount" text NOT NULL,
	"asset" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stablecoin_settlements_idempotency_idx" ON "stablecoin_settlements" ("idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stablecoin_settlements_clearing_idx" ON "stablecoin_settlements" ("clearing_transaction_id");
