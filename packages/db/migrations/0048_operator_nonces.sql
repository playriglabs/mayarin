-- The next nonce an operator key may use on a chain (SEC-04).
--
-- Read and written under an advisory lock so every process that signs with the
-- key sequences against the same counter. Written by hand like every migration
-- since 0009.
CREATE TABLE "operator_nonces" (
  "key" text PRIMARY KEY NOT NULL,
  "next_nonce" integer NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);
