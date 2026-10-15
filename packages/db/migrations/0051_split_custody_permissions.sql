-- Split custody and credential authority out of `settings:manage` (SEC-16).
--
-- `refunds:manage`, `api-keys:manage` and `wallets:withdraw` are new, and the
-- routes now require them. Everything that could do these things before keeps
-- doing them, so nobody loses access at deploy: accounts that held
-- `settings:manage` get all three, and every existing secret API key gets
-- `refunds:manage` (a secret key could refund before; that was the point of
-- the key). New accounts and keys get only what they are given. Written by
-- hand like every migration since 0009.
UPDATE "users"
SET "permissions" = "permissions" || ARRAY['refunds:manage', 'api-keys:manage', 'wallets:withdraw']
WHERE 'settings:manage' = ANY ("permissions")
  AND NOT ('refunds:manage' = ANY ("permissions"));

UPDATE "merchant_api_keys"
SET "permissions" = "permissions" || ARRAY['refunds:manage']
WHERE "kind" = 'secret'
  AND NOT ('refunds:manage' = ANY ("permissions"));
