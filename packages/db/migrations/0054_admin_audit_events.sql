-- Every call to the admin surface, allowed or denied (SEC-14).
--
-- The admin routes sit behind one shared bearer token, so there was no record of
-- who used it or what was done with it. This is that record: append-only, one row
-- per call, written before the handler runs. The token is never stored; only a
-- short fingerprint of it, which is enough to tell credentials apart across a
-- rotation.
--
-- Written by hand like every migration since 0009.
CREATE TABLE "admin_audit_events" (
  "id" text PRIMARY KEY NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "method" text NOT NULL,
  "path" text NOT NULL,
  "outcome" text NOT NULL,
  "source_ip" text,
  "token_fingerprint" text,
  CONSTRAINT "admin_audit_events_outcome_check" CHECK ("outcome" IN ('allowed', 'denied'))
);
--> statement-breakpoint
CREATE INDEX "admin_audit_events_time_idx" ON "admin_audit_events" ("occurred_at");
