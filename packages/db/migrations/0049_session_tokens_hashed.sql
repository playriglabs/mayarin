-- Session ids are stored hashed, and the CSRF token is derived, not stored (SEC-15).
--
-- Rows written before this hold the raw cookie value as `id`; none of them can
-- match a hashed lookup, so they are removed rather than left as a table of
-- live-looking credentials. Everyone signs in again once. Written by hand like
-- every migration since 0009.
DELETE FROM "sessions";
ALTER TABLE "sessions" DROP COLUMN "csrf_token";
