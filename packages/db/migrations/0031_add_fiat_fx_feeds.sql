-- The fiat registry gained thirteen pricing currencies, but runtime market
-- configuration is deliberately stored in Postgres after its first seed.
-- Updating FX_FEEDS in the deployment environment therefore leaves an existing
-- `fxFeeds` row unchanged and every new checkout fails with "No fresh oracle
-- price".
--
-- Add only missing pairs. The stored value is on the right of `||`, so an
-- operator's existing mapping wins when it already names one of these pairs.
-- This is a one-time upgrade rather than a merge on every boot: deleting a feed
-- later must remain a valid way to disable that market.
UPDATE "market_config"
SET
	"value" = '{
		"PHP/USDC": {"symbol": "USD/PHP", "invert": true},
		"VND/USDC": {"symbol": "USD/VND", "invert": true},
		"BND/USDC": {"symbol": "USD/BND", "invert": true},
		"MMK/USDC": {"symbol": "USD/MMK", "invert": true},
		"KHR/USDC": {"symbol": "USD/KHR", "invert": true},
		"LAK/USDC": {"symbol": "USD/LAK", "invert": true},
		"JPY/USDC": {"symbol": "USD/JPY", "invert": true},
		"CNY/USDC": {"symbol": "USD/CNY", "invert": true},
		"HKD/USDC": {"symbol": "USD/HKD", "invert": true},
		"EUR/USDC": {"symbol": "USD/EUR", "invert": true},
		"GBP/USDC": {"symbol": "USD/GBP", "invert": true},
		"AUD/USDC": {"symbol": "USD/AUD", "invert": true},
		"CAD/USDC": {"symbol": "USD/CAD", "invert": true}
	}'::jsonb || "value",
	"updated_at" = NOW()
WHERE "key" = 'fxFeeds'
	AND jsonb_typeof("value") = 'object';
