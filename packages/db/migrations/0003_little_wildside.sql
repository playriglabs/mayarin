-- New merchant account tenants. Every dashboard user belongs to one merchant.
CREATE TABLE "merchants" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
-- Backfill: each distinct existing merchant_id becomes a merchant row, so
-- already-scoped payments still resolve under the same id.
INSERT INTO "merchants" ("id", "name", "created_at", "updated_at")
SELECT DISTINCT u.merchant_id, 'Migrated ' || u.merchant_id, now(), now()
FROM "users" u
WHERE u.merchant_id IS NOT NULL;
--> statement-breakpoint
-- Old standalone admins (merchant_id NULL) had no merchant scope and are removed;
-- their sessions would orphan, so drop those first.
DELETE FROM "sessions"
WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "merchant_id" IS NULL);
--> statement-breakpoint
DELETE FROM "users" WHERE "merchant_id" IS NULL;
--> statement-breakpoint
DROP INDEX "users_role_idx";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "merchant_id" SET NOT NULL;--> statement-breakpoint
-- Add permissions nullable, backfill empty, then enforce NOT NULL (existing rows
-- have no value to carry over from the dropped role column).
ALTER TABLE "users" ADD COLUMN "permissions" text[];--> statement-breakpoint
UPDATE "users" SET "permissions" = '{}' WHERE "permissions" IS NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "permissions" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "merchants_name_idx" ON "merchants" USING btree ("name");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "role";