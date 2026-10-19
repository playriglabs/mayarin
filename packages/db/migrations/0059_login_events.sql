-- Login history: one row per successful sign-in, kept after the session is deleted.
CREATE TABLE "login_events" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id"),
  "ip" text NOT NULL,
  "user_agent" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "login_events_user_idx" ON "login_events" ("user_id", "created_at");
