[← Documentation index](./README.md)

# Deployment Targets

Mayarin uses separate Railway projects for testnet and mainnet. A deployment
target is selected explicitly by Railway project ID; it is never inferred from
the Git branch, the currently linked Railway project, or an environment name.

Deployments are manual. GitHub auto-deploy and CI/CD deployment workflows are
intentionally disabled. The operator runs the local verification suite, chooses
a target, migrates that target's database, deploys each service, and performs
smoke checks.

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
| `core-api`      | Public payment API                                            |
| `dashboard-api` | Merchant dashboard API                                        |
| `chain-worker`  | Continuous wallet watcher and settlement indexer              |
| `Postgres`      | Target-specific application state, cursors, ledger, and audit |

The dashboard UI is deployed separately to Cloudflare Pages. Its API URL must
point to the matching Railway target; a testnet UI must never call the mainnet
dashboard API, or the reverse.

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

Deploy the Cloudflare Pages dashboard only after both APIs are healthy, using
the dashboard API URL from the same target.

### 6. Deploy the testnet dashboard

The dashboard is an Astro SSR application on Cloudflare Pages. Its `/api/*`
route proxies to the testnet `dashboard-api` on Railway, which keeps session and
CSRF cookies same-origin in the browser. The target is recorded in
`apps/dashboard/wrangler.jsonc`:

- Pages project: `mayarin-dashboard-testnet`
- Pages variable: `API_URL=https://api-merchant-testnet.mayarin.xyz`
- Custom domain: `dashboard-testnet.mayarin.xyz`

Confirm the Railway API custom domain is healthy, authenticate Wrangler, and
deploy the locally verified build:

```bash
curl --fail --silent --show-error \
  https://api-merchant-testnet.mayarin.xyz/health

bunx wrangler login
bun run deploy:dashboard:testnet
```

`deploy:dashboard:testnet` runs the dashboard typecheck and production build
before `wrangler pages deploy`. The Pages project is not connected to GitHub;
this command is the only deployment path.

The dashboard proxy always uses the target's custom API hostname. Do not replace
it with Railway's generated hostname; testnet and mainnet must remain explicit
in both configuration and runtime traffic.

#### Dashboard custom domain

Attach `dashboard-testnet.mayarin.xyz` to the
`mayarin-dashboard-testnet` Pages project, then create this DNS record in the
`mayarin.xyz` Cloudflare zone:

| Type    | Name                | Target                                | Proxy   |
| ------- | ------------------- | ------------------------------------- | ------- |
| `CNAME` | `dashboard-testnet` | `mayarin-dashboard-testnet.pages.dev` | Enabled |

The Pages domain API can be called with Wrangler's OAuth token, but Wrangler's
standard OAuth scopes grant `zone:read`, not DNS Edit. If the CNAME does not
already exist, create it in the Cloudflare dashboard or with a separate API
token scoped to `Zone / DNS / Edit` for `mayarin.xyz`. Never commit that token.

After adding the CNAME, wait until the Pages custom-domain status is `active`
and Cloudflare has provisioned its certificate before running the smoke checks.

### 7. Smoke the deployment

For the current testnet deployment:

```bash
curl --fail --silent --show-error \
  https://api-testnet.mayarin.xyz/health

curl --fail --silent --show-error \
  https://api-merchant-testnet.mayarin.xyz/health

curl --fail --silent --show-error \
  https://dashboard-testnet.mayarin.xyz/login

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
bun run dev:dashboard:railway
bun run dev:railway
bun run seed:merchant:railway
```

The helper targets the registered `mayarin-testnet` project ID explicitly,
reads the Postgres proxy host, port, database, and credentials from Railway at
runtime, verifies the connection, and injects `DATABASE_URL` into the selected
local process. Credentials are kept in process memory and are neither printed
nor written to `.env`.

Use `bun run dev:dashboard:railway` for the merchant-to-checkout workflow: it
runs the local dashboard, dashboard API, and core API against testnet Railway
Postgres, without starting a second chain worker. Open the dashboard at
`http://localhost:4321`; checkout links remain on the local API origin at
`http://localhost:3000/checkout/:linkId`.
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

Automation may package the commands into explicit `deploy:testnet` and
`deploy:mainnet` wrappers later, but it must preserve the local verification,
target validation, migration ordering, mainnet confirmation, and smoke checks
described here.

---

## Related

- [Development](./development.md)
- [Architecture](./architecture.md)
- [Chain Layer](./chain.md)
- [Threat Model](./threat-model.md)
