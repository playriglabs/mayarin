-- What `PaymentCompleted` reported, recorded beside what was quoted (#12).
--
-- The indexer already read these off the log; until now they stopped at
-- `settlement_events` and the ledger was posted from the locked figures. A
-- payment where the two differ is the signal that a route behaved unexpectedly,
-- so they are kept side by side rather than one overwriting the other.
--
-- Nullable on purpose: a payment settled before this shipped has no on-chain
-- record to book from, and the engine falls back to the lock for those.
--
-- Written by hand for the same reason as 0010: the journal carries 0009/0010
-- without matching snapshots, so drizzle-kit cannot diff from the current
-- schema without re-proposing their changes.
ALTER TABLE "clearing_transactions" ADD COLUMN "on_chain_settled_amount" numeric(78, 0);
--> statement-breakpoint
ALTER TABLE "clearing_transactions" ADD COLUMN "on_chain_fee" numeric(78, 0);
--> statement-breakpoint
ALTER TABLE "clearing_transactions" ADD COLUMN "on_chain_refund_amount" numeric(78, 0);
