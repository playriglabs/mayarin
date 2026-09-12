-- Self-service registration: an account that exists but cannot sign in, and the
-- one-time code that changes that.
--
-- `users.email_verified_at` is nullable and has no default, so every account
-- that already exists reads as unverified — which would lock out every merchant
-- on the deployment. The backfill below is the point of this migration, not an
-- afterthought: an account created before self-registration existed was created
-- by an operator or a merchant-admin, somebody with access already vouched for
-- its address, and no code will ever be sent for it. `created_at` rather than
-- `now()` so the column reads as "verified when the account was made", which is
-- what actually happened.
--
-- Only the hash of a code is stored, so this table is useless to anyone who
-- reads it. A row is retired by `consumed_at` rather than deleted: how an
-- account came to be verified is worth keeping, and a deleted row would make a
-- replay indistinguishable from a first use.
--
-- Written by hand like every migration since 0009: drizzle-kit's snapshot chain
-- ends at 0008 and otherwise re-proposes 0009's settled rate rename.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "users" SET "email_verified_at" = "created_at" WHERE "email_verified_at" IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_verifications" ADD CONSTRAINT "email_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "email_verifications_user_idx" ON "email_verifications" USING btree ("user_id", "created_at");
