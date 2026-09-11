[← Documentation index](./README.md)

# Deployment Targets

Mayarin uses separate Railway projects for testnet and mainnet. A deployment
target is selected explicitly by Railway project ID; it is never inferred from
the Git branch, the currently linked Railway project, or an environment name.

Deployments are manual. GitHub auto-deploy and CI/CD deployment workflows are
intentionally disabled. The operator runs the local verification suite, chooses
a target, migrates that target's database, deploys each service, and performs
smoke checks.

`bun run deploy:testnet` is the packaged form of that sequence
(`scripts/deploy-testnet.ts`). It preserves every gate: the local check suite,
the checkout UI build, target validation against the registry below, explicit
migration (`--migrate` only), dependency-ordered service deploys, the
Cloudflare surfaces, and the smoke checks. It is still operator-initiated —
nothing triggers it on push or merge.

---

## Target Registry

| Target  | Railway project   | Project ID                             | Status      |
| ------- | ----------------- | -------------------------------------- | ----------- |
| Testnet | `mayarin-testnet` | `70236ce0-42f9-458e-bed1-b02ec10e5b7c` | Provisioned |
| Mainnet | `mayarin-mainnet` | Not created                            | Planned     |

The Railway environment inside each project may be named `production`. That
name describes Railway's environment lifecycle, not the blockchain network.
The project ID remains the authoritative deployment target.

The local `railway link` state is only a CLI convenience. Every deployment
command must still pass `--project`, `--environment`, and `--service`.

---

## Service Layout

Each target owns an isolated copy of the backend:

| Service         | Responsibility                                                |
| --------------- | ------------------------------------------------------------- |
| `core-api`      | Public payment API, and the hosted checkout/invoice pages     |
| `dashboard-api` | Merchant dashboard API                                        |
| `chain-worker`  | Continuous wallet watcher and settlement indexer              |
| `Postgres`      | Target-specific application state, cursors, ledger, and audit |

`core-api` serves the checkout UI SPA (#151) from its own image. The
Dockerfile builds `apps/checkout-ui` during the image build, so the bundle and
the API always deploy as one artifact — there is no separate checkout deploy
and no version skew between them.

The browser-facing surfaces deploy to Cloudflare separately:

| Surface   | Cloudflare project          | Path                                          |
| --------- | --------------------------- | --------------------------------------------- |
| Dashboard | `mayarin-dashboard-testnet` | `bun run deploy:dashboard:testnet`            |
| Pay proxy | `mayarin-pay-testnet`       | `bun run --cwd apps/pay-proxy deploy:testnet` |
| Demo      | `mayarin-demo`              | `bun run --cwd apps/demo deploy`              |
| Landing   | `mayarin-landing`           | `bun run deploy:landing`                      |

The pay proxy (`pay-testnet.mayarin.xyz`, RFC #163) is a Cloudflare Worker that
reverse-proxies a curated buyer path set to `core-api` on
`api-testnet.mayarin.xyz` and 404s everything else, so the full `/v1/*` API
surface is not exposed on the buyer origin. The SPA and its pages stay served
by `core-api`; the proxy just forwards them same-origin. `core-api` builds the
bootstrap `statusUrl` from `x-forwarded-host`, so a page loaded on the pay host
polls the pay host.

The dashboard's API URL must point to the matching Railway target; a testnet
UI must never call the mainnet dashboard API, or the reverse.

---

## Isolation Rules

Testnet and mainnet do not share mutable infrastructure or credentials:

- separate Railway projects and Postgres databases;
- separate RPC URLs, chain IDs, and start blocks;
- separate PaymentRouter and deposit-forwarder addresses;
- separate operator, quote-signing, Turnkey, and wallet-deployer keys;
- separate treasury and fee-recipient addresses;
- separate public domains and dashboard configuration;
- separate watcher cursors, ledger entries, sessions, and API keys.

Do not copy the testnet `.env` wholesale into mainnet. Provision each mainnet
value deliberately and verify it against the mainnet deployment record.

`OPERATOR_PRIVATE_KEY` belongs only on `chain-worker`. The core API must keep
`TREASURY_EXECUTION_ENABLED=false` and must not receive the operator key.

---

## Manual Deployment

`bun run deploy:testnet` runs steps 1–7 below in order. Its flags map onto the
steps: `--migrate` enables step 4 for schema and stored-data migrations,
`--only services,dashboard,demo` narrows steps 5–6, `--skip-gate` skips step 1
after a just-green local run. The
sections below remain the reference for what each step means and for running
any step by hand.

The demo (`apps/demo`) deploys with the same command its README documents:
`bun run --cwd apps/demo deploy`, to the `mayarin-demo` Pages project. Its
worker secret (`MAYARIN_SECRET_KEY`) lives in Cloudflare, never in this repo.

Set the target explicitly at the start of the shell session. These examples use
testnet:

```bash
export MAYARIN_RAILWAY_PROJECT=70236ce0-42f9-458e-bed1-b02ec10e5b7c
export MAYARIN_RAILWAY_ENVIRONMENT=production
```

### 1. Verify locally

Run the complete local gate before changing Railway:

```bash
bun install --frozen-lockfile
bun run setup -- --check
bun run check
```

Do not deploy when formatting, typechecking, or tests fail. Live-provider tests
also require their configured RPC endpoints to be reachable.

### 2. Review the target

Confirm that the selected ID resolves to the intended project:

```bash
railway status \
  --project "$MAYARIN_RAILWAY_PROJECT" \
  --environment "$MAYARIN_RAILWAY_ENVIRONMENT" \
  --json |
  jq '{id, name, workspace: .workspace.name}'
```

For testnet, the result must name `mayarin-testnet`. Stop if the ID or name does
not match the target registry.

### 3. Synchronize configuration

The checked-in helper reads only keys used by each service's validated config
and does not print their values:

```bash
bun run railway:env core-api
bun run railway:env dashboard-api
bun run railway:env chain-worker
```

The helper currently operates on the locally linked project. Before using it,
verify that `railway status` names the same project selected above. Deployment
commands remain explicitly targeted even after this check.

### 4. Migrate the target database

Supply `DATABASE_URL` for the selected target's Postgres TCP proxy, then apply
the checked-in migrations from the operator workstation:

```bash
DATABASE_URL='<target Postgres public URL>' bun run db:migrate
```

Never use the local `.env` value for this step: the development URL points at
local Postgres. Confirm the target project again before running a migration.
Migrations must complete before applications using the new schema are deployed.

### 5. Deploy in dependency order

Railway receives the verified local workspace. No GitHub push triggers these
commands:

```bash
railway up \
  --project "$MAYARIN_RAILWAY_PROJECT" \
  --environment "$MAYARIN_RAILWAY_ENVIRONMENT" \
  --service core-api

railway up \
  --project "$MAYARIN_RAILWAY_PROJECT" \
  --environment "$MAYARIN_RAILWAY_ENVIRONMENT" \
  --service dashboard-api

railway up \
  --project "$MAYARIN_RAILWAY_PROJECT" \
  --environment "$MAYARIN_RAILWAY_ENVIRONMENT" \
  --service chain-worker
```

Deploy the Cloudflare dashboard only after both APIs are healthy, using the
dashboard API URL from the same target.

### 6. Deploy the testnet dashboard

The dashboard UI is an Astro SSR application deployed as a Cloudflare Worker
with static assets — not to Pages, which `@astrojs/cloudflare` v12+ no longer
supports (#252). Its `/api/*` route proxies to the testnet `dashboard-api` on
Railway, which keeps session and CSRF cookies same-origin in the browser. The
target is recorded in `apps/dashboard/wrangler.jsonc`:

- Worker: `mayarin-dashboard-testnet`
- Worker variable: `API_URL=https://api-merchant-testnet.mayarin.xyz`
- KV binding: `SESSION` → namespace `mayarin-dashboard-testnet-SESSION`
- Route: `dashboard-testnet.mayarin.xyz/*` on the `mayarin.xyz` zone

Confirm the Railway API custom domain is healthy, authenticate Wrangler, and
deploy the locally verified build:

```bash
curl --fail --silent --show-error \
  https://api-merchant-testnet.mayarin.xyz/health

bunx wrangler login
bun run deploy:dashboard:testnet
```

`deploy:dashboard:testnet` runs the dashboard typecheck and production build
before `wrangler deploy -c dist/server/wrangler.json`. The adapter writes that
file and merges `wrangler.jsonc` into it. The Worker is not connected to
GitHub; this command is the only deployment path.

The server reads `API_URL` at runtime through `getSecret` from
`astro:env/server` (`apps/dashboard/src/lib/api/origin.ts`).
`Astro.locals.runtime.env` was removed in Astro 6 and throws on access — every
`/api/*` call answers 500 and every session check fails.

The dashboard proxy always uses the target's custom API hostname. Do not replace
it with Railway's generated hostname; testnet and mainnet must remain explicit
in both configuration and runtime traffic.

#### Dashboard hostname

`dashboard-testnet.mayarin.xyz` is served through a Worker **route**, not a
Worker custom domain. The hostname is still attached to the retired
`mayarin-dashboard-testnet` Pages project, with a proxied `CNAME` to
`mayarin-dashboard-testnet.pages.dev`. A custom domain refuses a hostname that
another project or a DNS record already holds; a route runs in front of the
proxied record, so the Worker takes the traffic without a DNS change or
downtime. Wrangler's OAuth token has `workers_routes` write, which is all a
route needs.

Detaching the Pages domain and deleting the CNAME is optional cleanup. Do it
only together with replacing the route by a `custom_domain` route in
`wrangler.jsonc` — a route with no proxied DNS record behind it serves nothing.

### Deploy the pay proxy

The pay proxy is a Cloudflare Worker (`apps/pay-proxy`) that fronts the hosted
checkout on `pay-testnet.mayarin.xyz` (RFC #163). It forwards only the buyer
path allowlist (`/checkout/*`, `/checkout-ui/*`, `/invoices/:id/view`, and the
SPA's `/v1/*` calls) to `core-api` on `api-testnet.mayarin.xyz` and returns 404
for everything else. The target is recorded in `apps/pay-proxy/wrangler.jsonc`:

- Worker: `mayarin-pay-testnet`
- Worker variable: `ORIGIN=https://api-testnet.mayarin.xyz`
- Custom domain: `pay-testnet.mayarin.xyz`

Confirm the `core-api` custom domain is healthy (the proxy forwards to it),
authenticate Wrangler, and deploy:

```bash
curl --fail --silent --show-error \
  https://api-testnet.mayarin.xyz/health

bunx wrangler login
bun run --cwd apps/pay-proxy deploy:testnet
```

`deploy:testnet` runs the worker typecheck before `wrangler deploy`. The Worker
is not connected to GitHub; this command is the only deployment path.

#### Pay proxy custom domain

`wrangler.jsonc` declares `pay-testnet.mayarin.xyz` as a `custom_domain` route,
so `wrangler deploy` attempts to bind it. The same scope limit as the dashboard
CNAME applies: Wrangler's OAuth token has `zone:read`, not `Zone / DNS / Edit`.
If the binding fails, attach `pay-testnet.mayarin.xyz` to the
`mayarin-pay-testnet` Worker in the Cloudflare dashboard (Workers → the worker
→ Settings → Domains & Routes), or use a separate API token scoped to
`Zone / DNS / Edit` for `mayarin.xyz`. Never commit that token.

After the route is bound, wait until the certificate is active before running
the smoke checks.

Set `CHECKOUT_BASE_URL=https://pay-testnet.mayarin.xyz` on **both** the
`core-api` and `dashboard-api` Railway services. `core-api` builds the
payment-link and invoice `url` it returns to API clients (the SDK, the demo)
from it; `dashboard-api` builds the link `url` + dashboard QR shown to
merchants from it. Both default to `PUBLIC_BASE_URL`; the override points every
buyer-facing URL at the pay host. No code change beyond the config field.

### Deploy the landing site

The landing site is a static Vite application deployed manually to the
`mayarin-landing` Cloudflare Pages project. Its target is recorded in
`apps/landing/wrangler.jsonc`; it has no runtime API or environment variables.

```bash
nvm use 22
wrangler login
bun run deploy:landing
```

`deploy:landing` typechecks and builds the landing app, applies pending
`mayarin-landing-early-access` D1 migrations, then uploads its `dist` directory.
Wrangler requires Node.js 22 or newer. The Pages project is not connected to
GitHub. List early-access submissions without exposing an admin HTTP route:

```bash
bun run --cwd apps/landing early-access:list
```

### 7. Smoke the deployment

For the current testnet deployment:

```bash
curl --fail --silent --show-error \
  https://api-testnet.mayarin.xyz/health

curl --fail --silent --show-error \
  https://api-merchant-testnet.mayarin.xyz/health

curl --fail --silent --show-error \
  https://dashboard-testnet.mayarin.xyz/login

# The checkout routes are mounted and answering. The SPA bundle is proven by
# the Dockerfile build + the local gate, not a runtime file: `apps/checkout-ui`
# ships no favicon in its dist (the page loads favicons from mayarin.xyz), so
# `/checkout/qr` — stable, no DB, 200 SVG — is the liveness probe.
curl --fail --silent --show-error \
  "https://api-testnet.mayarin.xyz/checkout/qr?value=smoke"

# The pay proxy (RFC #163): same probe through the proxy proves the Worker
# route is bound, the allowlist forwards `/checkout/*`, and core-api is reached.
curl --fail --silent --show-error \
  "https://pay-testnet.mayarin.xyz/checkout/qr?value=smoke"

# A non-buyer /v1 route must be hidden on the pay host (expect 404).
curl --silent --output /dev/null --write-out "%{http_code}\n" \
  https://pay-testnet.mayarin.xyz/v1/merchants

railway logs \
  --project "$MAYARIN_RAILWAY_PROJECT" \
  --environment "$MAYARIN_RAILWAY_ENVIRONMENT" \
  --service chain-worker \
  --lines 100
```

The API checks must return healthy responses. The worker logs must show its
configured watcher pairs and settlement indexers running without a repeating
configuration, database, or RPC failure.

### Access testnet Postgres locally

Railway private hostnames such as `postgres.railway.internal` resolve only from
services inside the Railway project. Do not put that hostname in the local
`.env` when using Drizzle Studio. Use the public TCP proxy through the checked-in
helper instead:

```bash
railway login
bun run db:check:railway
bun run db:studio:railway
bun run dev:railway
bun run seed:merchant:railway
```

The helper targets the registered `mayarin-testnet` project ID explicitly,
reads the Postgres proxy host, port, database, and credentials from Railway at
runtime, verifies the connection, and injects `DATABASE_URL` into the selected
local process. Credentials are kept in process memory and are neither printed
nor written to `.env`.

Use `bun run dev:railway` when the core API, chain worker, dashboard API, and
dashboard UI all need to run locally. Use `bun run db:migrate:railway` only
after reviewing pending migrations; it changes the shared testnet database.
Use `bun run seed:merchant:railway` to create a merchant in that shared testnet
database; all normal seed flags and interactive prompts are forwarded.
The existing `bun run dev:all`, `bun run db:studio`, and `bun run db:migrate`
commands continue to use the local `.env` and Docker Postgres.

---

## Mainnet Gate

Create `mayarin-mainnet` as a new Railway project; do not clone the testnet
database or reuse its secrets. Before the first mainnet deployment, add its
project ID to the target registry above and verify all of the following:

- the selected project name is `mayarin-mainnet`;
- every configured chain is a mainnet chain;
- every contract address is the recorded mainnet deployment;
- the database is empty or comes from an approved mainnet migration;
- custody and signing keys use the mainnet-specific perimeter;
- treasury, fee recipient, and merchant-facing domains are mainnet values;
- the operator has reviewed the exact Git commit being deployed.

The operator must type the complete phrase `deploy mayarin mainnet` before the
mainnet migration or first service deployment. A future deployment wrapper must
enforce this phrase and compare the project ID against the registry; it must not
offer a default target.

---

## What Must Stay Manual

- No deployment on push or merge.
- No GitHub Actions deployment workflow.
- No Railway GitHub source auto-deploy.
- No branch-to-environment inference.
- No implicit use of the locally linked Railway project.

`deploy:testnet` (`scripts/deploy-testnet.ts`) is that wrapper for testnet. It
preserves the local verification, target validation, migration ordering, and
smoke checks described here. A `deploy:mainnet` wrapper must additionally
enforce the confirmation phrase above before it exists.

---

## Related

- [Development](./development.md)
- [Architecture](./architecture.md)
- [Chain Layer](./chain.md)
- [Threat Model](./threat-model.md)
