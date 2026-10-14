-- How a payment was funded when it was not funded by the payer's own wallet.
--
-- A payer who pays in GCash, QRIS or a bank transfer is funded by TransFi, which
-- delivers the stablecoin to the intent's deposit address. The payment itself is
-- unchanged — same intent, same deposit-match path — but nothing recorded that a
-- fiat order stood behind it, so a merchant saw "scan with a crypto wallet" for a
-- payment somebody paid with a rupiah QR.
--
-- One row per provider order, not per payment: a payer who abandons a QR and
-- starts again makes a second order against the same intent.
--
-- `fiat_amount` is the amount the payer was asked to pay, as a decimal string:
-- it is a record of what was shown, not a figure anything calculates with.
--
-- Written by hand like every migration since 0009.
CREATE TABLE "payment_fundings" (
  "order_id" text PRIMARY KEY NOT NULL,
  "payment_intent_id" text NOT NULL,
  "merchant_id" text NOT NULL,
  "kind" text NOT NULL,
  "provider" text NOT NULL,
  "payment_code" text NOT NULL,
  "payment_name" text NOT NULL,
  "fiat_currency" text NOT NULL,
  "fiat_amount" text NOT NULL,
  "status" text NOT NULL,
  "settled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "payment_fundings_kind_check" CHECK ("kind" IN ('local-currency'))
);
--> statement-breakpoint
CREATE INDEX "payment_fundings_intent_idx" ON "payment_fundings" USING btree ("payment_intent_id", "created_at");
--> statement-breakpoint
CREATE INDEX "payment_fundings_open_idx" ON "payment_fundings" USING btree ("settled_at", "created_at");
