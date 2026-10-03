-- Merchant notifications. The feed itself is derived from the records the
-- system already keeps; these two columns are the only state it adds.
--
-- `users.notifications_read_at` is the reader's "seen up to" mark: a
-- notification is unread when it occurred after it. Null, everything is.
--
-- `clearing_transactions.escrow_closed_at` is when the keeper saw an escrow
-- close. An undisputed release is the moment an escrowed merchant is paid,
-- and `escrow_outcome` alone does not say when that was.
--
-- Written by hand like every migration since 0009.
ALTER TABLE "users" ADD COLUMN "notifications_read_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "clearing_transactions" ADD COLUMN "escrow_closed_at" timestamp with time zone;
