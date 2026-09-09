-- AED, SAR, BRL and MXN extend pricing into the Middle East and Latin America.
-- Runtime market configuration is stored in Postgres after its first seed, so
-- changing FX_FEEDS alone would not update an existing deployment.
--
-- Add only missing pairs. The stored value is on the right of `||`, preserving
-- any operator override that already configures one of these markets.
UPDATE "market_config"
SET
	"value" = '{
		"AED/USDC": {"symbol": "USD/AED", "invert": true},
		"SAR/USDC": {"symbol": "USD/SAR", "invert": true},
		"BRL/USDC": {"symbol": "USD/BRL", "invert": true},
		"MXN/USDC": {"symbol": "USD/MXN", "invert": true}
	}'::jsonb || "value",
	"updated_at" = NOW()
WHERE "key" = 'fxFeeds'
	AND jsonb_typeof("value") = 'object';
