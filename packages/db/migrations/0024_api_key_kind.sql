-- API key kinds (#113): `secret` (sk_..., server-side, permission-scoped) and
-- `publishable` (pk_..., ships in a browser bundle, fixed public surface).
--
-- Written by hand like every migration since 0009. Every existing key predates
-- publishable keys, so the default backfills them all as `secret` — which is
-- what they are.
ALTER TABLE "merchant_api_keys"
  ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'secret';
