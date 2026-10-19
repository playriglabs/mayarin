-- Failed sign-in passwords per email, shared by every dashboard-api replica (SEC-08).
--
-- Keyed by a digest of the email as typed, so a made-up address leaves no
-- readable trace. Rows are pruned a day after their last failure. Written by
-- hand like every migration since 0009.
CREATE TABLE "login_failures" (
  "key" text PRIMARY KEY NOT NULL,
  "count" integer NOT NULL,
  "blocked_until" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "login_failures_updated_idx" ON "login_failures" ("updated_at");
