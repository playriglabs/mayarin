-- Robinhood Chain testnet is no longer a supported chain.
--
-- Only configuration and derived scan state is cleaned here: a merchant's
-- per-chain overrides and local-currency chain would otherwise name a chain
-- `isChainId` refuses, and the watcher's cursor is read by nothing now. Payments,
-- deposits and settlements that already happened keep their rows — they are
-- history, not configuration.
UPDATE "merchants"
	SET "settlement_asset_by_chain" = "settlement_asset_by_chain" - 'robinhood-testnet'
	WHERE "settlement_asset_by_chain" ? 'robinhood-testnet';
--> statement-breakpoint
UPDATE "merchants"
	SET "accepted_assets_by_chain" = "accepted_assets_by_chain" - 'robinhood-testnet'
	WHERE "accepted_assets_by_chain" ? 'robinhood-testnet';
--> statement-breakpoint
UPDATE "merchants"
	SET "local_currency_chain" = NULL
	WHERE "local_currency_chain" = 'robinhood-testnet';
--> statement-breakpoint
DELETE FROM "watcher_cursors" WHERE "chain" = 'robinhood-testnet';
