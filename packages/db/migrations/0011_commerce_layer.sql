-- Commerce layer (#10): catalog products, their prices, and payment links.
--
-- Written by hand for the same reason `0010_audit_merchant_index` was:
-- `0009_scaled_rate` was added to the journal without a matching
-- `meta/0009_snapshot.json`, so drizzle-kit cannot diff from the current schema
-- and re-proposes 0009's rename. Regenerating that snapshot is a repo-wide fix,
-- not this change's business.
--
-- `merchant_id` carries no foreign key here, matching `payment_intents`:
-- merchant ids on the payment side are denormalised snapshots and need not
-- exist as account rows.

-- The merchant's own order/invoice id, carried on every intent. Deliberately
-- not unique — a buyer whose first attempt expired retries under the same
-- reference, and collapsing those would lose the failed attempt.
ALTER TABLE "payment_intents" ADD COLUMN "merchant_reference" text;
--> statement-breakpoint
-- Leading on `merchant_id` keeps a reference lookup on one merchant's rows: two
-- merchants may both call an order "INV-1".
CREATE INDEX "payment_intents_merchant_reference_idx" ON "payment_intents" USING btree ("merchant_id","merchant_reference");
--> statement-breakpoint

CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"active" boolean NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "products_merchant_sku_idx" ON "products" USING btree ("merchant_id","sku");
--> statement-breakpoint
CREATE INDEX "products_merchant_idx" ON "products" USING btree ("merchant_id","created_at");
--> statement-breakpoint

-- A price per currency, in its own table so every amount stays an exact
-- numeric(78, 0) count of minor units. The composite primary key is what makes
-- "one price per currency" a database fact rather than a hope.
CREATE TABLE "product_prices" (
	"product_id" text NOT NULL,
	"asset" text NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	CONSTRAINT "product_prices_product_id_asset_pk" PRIMARY KEY("product_id","asset")
);
--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

-- A payment link is a template that mints Payment Intents; it holds no payment
-- state of its own. `expires_at` and `disabled_at` decide only whether another
-- intent may be minted — the intents it produced carry the payments.
CREATE TABLE "payment_links" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"merchant_id" text NOT NULL,
	"merchant_name" text NOT NULL,
	"merchant_city" text NOT NULL,
	"merchant_country_code" text NOT NULL,
	"merchant_category_code" text,
	"amount" numeric(78, 0),
	"amount_asset" text,
	"currency" text,
	"lines" jsonb,
	"title" text,
	"merchant_reference" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"idempotency_key" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_links_idempotency_key_idx" ON "payment_links" USING btree ("idempotency_key");
--> statement-breakpoint
CREATE INDEX "payment_links_merchant_idx" ON "payment_links" USING btree ("merchant_id","created_at");
