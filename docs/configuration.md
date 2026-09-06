# Configuration

Three kinds of configuration live in this system and they are not
interchangeable. Putting a value in the wrong one is the mistake this document
exists to prevent: it is cheap to fix on the day and expensive a year later,
when something has been reading it from the wrong place ever since.

The rule is one question — **when does this value change?**

| Kind                   | Changes when                  | Lives in                  | Who writes it               |
| ---------------------- | ----------------------------- | ------------------------- | --------------------------- |
| Deployment identity    | a redeploy                    | `.env`, validated at boot | whoever deploys             |
| Merchant configuration | a merchant changes their mind | `merchants` rows          | the merchant, authenticated |
| Market data            | the market changes            | `market_config` rows      | an operator, admin-token    |

## Deployment identity — environment

`PAYMENT_ROUTERS`, `DEPOSIT_FORWARDERS`, `DEPOSIT_FORWARDER_INIT_CODE_HASH`,
`TREASURY_ADDRESS`, `OPERATOR_PRIVATE_KEY`, `DATABASE_URL`, `PUBLIC_BASE_URL`,
and the `*_RATE_LIMIT_*` controls.

These change only on a redeploy, and two of them argue actively **against** ever
being runtime-editable:

- `DEPOSIT_FORWARDER_INIT_CODE_HASH` determines every deposit address ever
  issued. Changing it at runtime orphans addresses already handed to payers.
- `TREASURY_ADDRESS` is where fees are paid. A mutable one is a redirect of
  funds behind a single API call.

Boot-time and validated is the right shape: a deployment with a bad value should
fail to start, not fail on its first payment.

### API rate limiting

Both versioned HTTP surfaces use a per-process, per-client token bucket. The
payment API defaults to `API_RATE_LIMIT_REQUESTS=120`; the dashboard API defaults
to `DASHBOARD_RATE_LIMIT_REQUESTS=120`. An empty bucket refills completely over
`RATE_LIMIT_WINDOW_SECONDS=60`. Rejected requests return `429`, a stable
`RATE_LIMIT_EXCEEDED` error body, and `Retry-After` plus `RateLimit-*` headers.
Exhausting any bucket starts a fixed `RATE_LIMIT_BLOCK_SECONDS=300` lockout.
Every request covered by that bucket remains rejected during the penalty;
retries neither bypass nor extend it. Health checks and CORS preflight requests
do not consume the budget.

Dashboard login attempts also pass through a tighter, independent bucket. It
defaults to `DASHBOARD_LOGIN_RATE_LIMIT_REQUESTS=5` attempts over
`DASHBOARD_LOGIN_RATE_LIMIT_WINDOW_SECONDS=60` and uses the same five-minute
lockout. This prevents password guessing at a pace that the broader dashboard
traffic budget intentionally permits.

`RATE_LIMIT_CLIENT_IP_SOURCE=socket` identifies direct callers from the socket.
Behind a reverse proxy, select `cf-connecting-ip`, `x-real-ip`, or
`x-forwarded-for` only when that proxy overwrites the selected header with the
real client address. Mayarin's Cloudflare-fronted Railway deployments use
`cf-connecting-ip`. The dashboard Pages proxy copies the original visitor into
`x-real-ip` so Cloudflare preserves that identity on its same-zone subrequest to
the API. Trusting a caller-controlled header lets an abusive client rotate fake
addresses and evade the limit. The Railway-generated origin hostname therefore
must not be treated as a protected public entry point; production must block
direct-origin bypass at the edge. `RATE_LIMIT_MAX_CLIENTS=10000` bounds the
number of buckets held by one process; excess identities share a protective
overflow bucket.

The counters are intentionally process-local. A deployment with multiple API
replicas therefore applies the configured budget independently in each replica;
use a load-balancer or shared rate-limit store when a strict fleet-wide quota is
required.

## Merchant configuration — database, written through an authenticated API

`settlement_asset`, `accepted_assets`, `settlement_address` — per-merchant rows,
because they always were per-merchant facts. `MERCHANT_SAFE_ADDRESS` was removed
from the environment precisely because one deployment-wide payout address pays
every merchant into the same wallet.

Written through `PATCH /settings` on the dashboard API:

- Scoped to the authenticated merchant. No route takes a merchant id, so there
  is nothing to tamper with.
- Gated on `settings:manage`, its own permission rather than `admin:access` —
  reading payments and managing users is no reason to redirect payouts.
- CSRF-guarded, like every other state-changing route.
- Validated at the write. A malformed payout address is refused here, not
  discovered at `PRICE_LOCKED` months later with nobody left to ask.
- Audited. Every change appends a row to `merchant_setting_changes` recording
  who changed what, and from what. That table is append-only.
- Optimistically locked. `merchants.version` is the token the write takes, so
  two people editing at once raise `ConcurrencyError` rather than resolving to
  whichever write happened to land second. The audit trail would record both
  attempts either way; this is what stops the losing one taking effect.

`GET /settings/history` reads that trail back, scoped the same way.

## Market data — database, written through an admin endpoint

Which stablecoins are admitted, which oracle feed serves a pair, which pool
prices a swap. None of these are properties of _this_ deployment; they are facts
about the market, and they change far more often than a deploy. Adding IDR
pricing used to mean editing `PYTH_FEEDS` and restarting.

Keys, all validated by the same zod schema that parses them out of an
environment string:

| Key              | What it holds                                   |
| ---------------- | ----------------------------------------------- |
| `stablecoins`    | admissible assets and their on-chain identities |
| `exchangeRates`  | the static rate table (development stand-in)    |
| `pythFeeds`      | crypto pair → Hermes feed                       |
| `fxFeeds`        | fiat pair → FX API series                       |
| `chainlinkFeeds` | pair → on-chain aggregator                      |
| `uniswapPools`   | pair → pool                                     |

These split along the two legs a payment has, not along provider preference.
`QuoteEngine` prices fiat → settlement through the oracle alone (no venue quotes
rupiah) and payer asset → settlement through the venue under an oracle guard, so
a deployment needs a reference for each leg and no cross rate between them.

Which oracle serves which pair is not a property of the asset class. Pyth Core's
2026-08-26 upgrade put Hermes behind an API key and a grant, and a default key's
grant is a per-feed allowlist of majors: measured on one, `Crypto.ETH/USD`,
`BTC`, `SOL`, `USDT`, `USDC` and `FX.EUR/USD` are granted, while
`Crypto.SUI/USD`, `Crypto.ARB/USD`, `Crypto.EURC/USD` and every
`FX.USD/{IDR,SGD,THB,MYR}` answer `403 Not entitled`. A denied Crypto feed sits
beside a granted FX one. **Probe a feed against the deployment's own key before
configuring it.**

Name every source in `QUOTE_ORACLE` and `QUOTE_ORACLE_FALLBACKS`; one with no
feed for a pair drops out of that read rather than failing it, which is what
lets three partial sources cover a matrix none of them covers alone.

Read with `GET /admin/market-config`, written with
`PUT /admin/market-config/:key`, both behind `ADMIN_TOKEN`. **A writable feed
map is a writable price**: an endpoint that can point a feed at the wrong id can
mis-price every payment until someone notices, which is why this is not a
merchant-facing surface.

### How a change takes effect

Everything derived from market data — the stablecoin registry, the rate table,
the quote layer — is **rebuilt from scratch** when the configuration changes,
never patched in place. A registry half-updated from two snapshots is a state
nothing else in the codebase can express, and it would surface as a mis-priced
payment rather than as an error.

The snapshot is cached for a few seconds, so the payment path pays one query per
window rather than one per quote. A write through the admin endpoint drops that
cache immediately; a write made directly to the table is picked up when the
window rolls.

### Seeding, and the failure mode

On boot the environment's values are written into the table **only for keys it
does not already hold**. A plain write on every boot would undo an operator's
change each restart, which would make the feature a no-op that looks like it
works.

A stored value that cannot be parsed falls back to the environment's. The
deployment booted with those values and they are known-good, so a bad row
degrades to the last thing known to work rather than taking the processor down.
A bad _write_ never gets that far: it is validated before it is stored, and the
in-memory snapshot is left alone.

## Adding a new value

Ask when it changes.

- On a redeploy, or it decides where funds go → `.env`, boot-validated.
- When a merchant changes their mind → a `merchants` column and the settings
  API. If it moves money, audit it.
- When the market changes → a `market_config` key, with a zod schema, and think
  about what a wrong value does before exposing the endpoint.
