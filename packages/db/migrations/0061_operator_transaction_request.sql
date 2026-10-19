-- What an operator transaction asked for, so a stuck one can be replaced (SEC-04).
--
-- A replacement under the same nonce must carry the same call. These stay NULL
-- for a row whose submitter did not record it, which the bumper leaves alone.
-- Written by hand like every migration since 0009.
ALTER TABLE "operator_transactions" ADD COLUMN "to_address" text;
--> statement-breakpoint
ALTER TABLE "operator_transactions" ADD COLUMN "data" text;
--> statement-breakpoint
ALTER TABLE "operator_transactions" ADD COLUMN "value" text;
--> statement-breakpoint
ALTER TABLE "operator_transactions" ADD COLUMN "bump_count" integer NOT NULL DEFAULT 0;
