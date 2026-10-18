-- Idle expiry for sessions (SEC-15).
--
-- The time a session last served a request. Null on a row from before this
-- column, which the application reads as its creation time.
ALTER TABLE "sessions" ADD COLUMN "last_seen_at" timestamp with time zone;
