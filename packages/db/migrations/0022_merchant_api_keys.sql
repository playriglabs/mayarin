-- Merchant API keys: bearer-token access to the dashboard API. High-entropy
-- secrets → sha-256 of the full plaintext (not argon2; threat is online lookup,
-- not offline cracking of a low-entropy password). Prefix = first chars of the
-- plaintext, shown in listings so a merchant can ID a key without the secret.
-- Written by hand, like 0009 onward.
CREATE TABLE IF NOT EXISTS "merchant_api_keys" (
  "id" text PRIMARY KEY NOT NULL,
  "merchant_id" text NOT NULL REFERENCES "merchants"("id"),
  "name" text NOT NULL,
  "secret_hash" text NOT NULL,
  "prefix" text NOT NULL,
  "permissions" text[] NOT NULL,
  "last_used_at" timestamp with time zone,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL,
  "version" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "merchant_api_keys_merchant_idx" ON "merchant_api_keys" ("merchant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "merchant_api_keys_secret_hash_idx" ON "merchant_api_keys" ("secret_hash");