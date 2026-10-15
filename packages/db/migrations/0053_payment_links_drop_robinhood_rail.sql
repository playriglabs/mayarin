-- 0046 cleaned `merchants` but missed `payment_links.rails`. A link whose rail
-- names Robinhood Chain testnet makes `toLinkRails` throw, which fails the whole
-- payment-links list for that merchant.
--
-- A link restricted only to the removed chain can no longer be paid, and
-- dropping its restriction (`rails = NULL`) would widen it to every rail, so it
-- is disabled instead. A link with other rails just loses the dead entry.
UPDATE "payment_links"
	SET "disabled_at" = COALESCE("disabled_at", now())
	WHERE "rails" @> '[{"chain":"robinhood-testnet"}]'::jsonb
	AND NOT EXISTS (
		SELECT 1 FROM jsonb_array_elements("rails") AS rail
		WHERE rail->>'chain' <> 'robinhood-testnet'
	);
--> statement-breakpoint
UPDATE "payment_links"
	SET "rails" = (
		SELECT jsonb_agg(rail) FROM jsonb_array_elements("rails") AS rail
		WHERE rail->>'chain' <> 'robinhood-testnet'
	)
	WHERE "rails" @> '[{"chain":"robinhood-testnet"}]'::jsonb;
