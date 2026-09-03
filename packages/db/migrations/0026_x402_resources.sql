-- Endpoints a merchant has made payable per call over x402 (#207).
--
-- `accepts` is JSON rather than a child table because an entry is only ever
-- read and written whole: a resource's ways to pay are rebuilt together from a
-- capability probe at boot, never edited one at a time. A row of columns would
-- buy joins nobody makes and a migration every time the probe learns to record
-- one more fact about a token.
--
-- The unique index on (merchant_id, url) is load-bearing rather than tidy: two
-- resources gating the same URL for one merchant would make the price of a
-- request depend on which row was read first.
--
-- Written by hand like every migration since 0009: drizzle-kit's snapshot chain
-- ends at 0008 and otherwise re-proposes 0009's settled rate rename.
CREATE TABLE "x402_resources" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"mime_type" text,
	"price_amount" numeric(78, 0) NOT NULL,
	"price_asset" text NOT NULL,
	"accepts" jsonb NOT NULL,
	"max_timeout_seconds" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "x402_resources_merchant_id_merchants_id_fk"
		FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id")
		ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "x402_resources_merchant_idx"
	ON "x402_resources" USING btree ("merchant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "x402_resources_merchant_url_idx"
	ON "x402_resources" USING btree ("merchant_id", "url");
