-- Runtime configuration (#95): merchant settings get an audit trail, and market
-- data moves out of the environment into a table.
--
-- Written by hand for the same reason `0010_audit_merchant_index` was:
-- `0009_scaled_rate` was added to the journal without a matching
-- `meta/0009_snapshot.json`, so drizzle-kit cannot diff from the current schema
-- and re-proposes 0009's rename. Regenerating that snapshot is a repo-wide fix,
-- not this change's business.
--
-- Numbered 0012, skipping 0011, because `0011_commerce_layer` is in flight on
-- another branch (#10). The two touch no common table, so applying them in
-- either order is safe; the gap is deliberate rather than a lost migration.

-- Append-only. `settlement_address` is where a merchant's money goes, so who
-- changed it and when has to survive the change itself. Nothing in the
-- application updates or deletes a row here.
CREATE TABLE "merchant_setting_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"field" text NOT NULL,
	"previous_value" text,
	"next_value" text,
	"changed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "merchant_setting_changes" ADD CONSTRAINT "merchant_setting_changes_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_setting_changes" ADD CONSTRAINT "merchant_setting_changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "merchant_setting_changes_merchant_idx" ON "merchant_setting_changes" USING btree ("merchant_id","changed_at");
--> statement-breakpoint

-- Market data: which stablecoins are admitted, which oracle feed serves a pair,
-- which pool prices a swap. Facts about the market, not about this deployment,
-- and they change far more often than a deploy. `value` is opaque JSON — each
-- key already has a zod schema that parses it out of an environment string, and
-- the same schema parses it back out of here.
CREATE TABLE "market_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" text
);
--> statement-breakpoint

-- `settings:manage` is a new permission gating who may redirect a merchant's
-- payouts. Existing merchant admins already had every surface, so granting it to
-- them preserves what they could do; nobody else gains anything.
UPDATE "users" SET "permissions" = array_append("permissions", 'settings:manage')
WHERE 'admin:access' = ANY("permissions") AND NOT ('settings:manage' = ANY("permissions"));
