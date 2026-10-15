-- A rotated-out webhook secret stops signing after a grace period (SEC-12).
--
-- Existing rows keep their previous secret for one more day from the last
-- change, then it is ignored; the column is cleared opportunistically by the
-- next rotation. Written by hand like every migration since 0009.
ALTER TABLE "webhook_endpoints" ADD COLUMN "previous_secret_expires_at" timestamp with time zone;
UPDATE "webhook_endpoints"
SET "previous_secret_expires_at" = "updated_at" + interval '24 hours'
WHERE "previous_secret" IS NOT NULL;
