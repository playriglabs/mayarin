-- Authenticator-app second factor (SEC-15, SEC-16).
--
-- `mfa_secret` holds the application-encrypted TOTP secret from the moment setup
-- starts; `mfa_enabled_at` is set only once the account has typed a valid code,
-- and is what the sign-in and withdrawal checks read. Written by hand like every
-- migration since 0009.
ALTER TABLE "users" ADD COLUMN "mfa_secret" text;
ALTER TABLE "users" ADD COLUMN "mfa_enabled_at" timestamp with time zone;
ALTER TABLE "users" ADD COLUMN "mfa_last_step" integer;
ALTER TABLE "users" ADD COLUMN "mfa_recovery_hashes" text[] NOT NULL DEFAULT '{}'::text[];
