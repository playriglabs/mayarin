[← Documentation index](./README.md)

# Mainnet Launch Checklist

What has to be true before real money moves, in the order to do it. It collects
the work tracked in the security programme (#143) into one list; the RFC stays
the authority on what each item means and what is still open. A box here is
ticked by verifying the thing, not by a merged PR.

The deployment mechanics are in [deployment.md](./deployment.md#mainnet-gate).
Incident procedures are in [runbooks.md](./runbooks.md).

## 1. The code refuses to boot unfinished

These are enforced at start-up, so a missing one is a failed deploy rather than a
quiet gap. Set all of them on the payment API:

| Variable                        | What it does                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `MAX_PAYMENT_SETTLEMENT`        | Largest single payment per settlement asset. Required with any mainnet chain.                                       |
| `WEBHOOK_SECRET_ENCRYPTION_KEY` | Encrypts webhook signing secrets in the database. Required with any mainnet chain. Same value on the dashboard API. |
| `CHAIN_ASSETS` / market config  | Only tokens in `packages/core/chain/src/reviewed-tokens.ts` are accepted on `base` and `arbitrum`.                  |
| `QUOTE_SIGNER`                  | `local` is refused for a mainnet router: use `turnkey` or the AWS KMS signer.                                       |

Optional but part of the launch posture:

- `MAX_MERCHANT_DAILY_SETTLEMENT`: rolling 24-hour ceiling per merchant and asset.
- `ALLOWED_HOSTS`: the public hostnames; any other `Host` is a 404. `/health` is exempt.
- `ADMIN_ALLOWED_HOSTS`: where `/v1/admin` answers (a private name); list it in `ALLOWED_HOSTS` too.
- `API_KEY_RATE_LIMIT_REQUESTS`: per-key budget (default 600 per window).
- `SESSION_IDLE_SECONDS`: dashboard idle sign-out (default 3600).

## 2. A mainnet that shares nothing with testnet

- [ ] New Railway project, database, domains, RPC credentials, signers, Turnkey
      organisation and policies, webhook keys, API/session secrets. Nothing copied
      from testnet.
- [ ] Database not reachable from the internet; each service on its own role
      (`scripts/db-roles.ts`), and the roles wired into the service connection
      strings. Migrations applied by a separate short-lived role.
- [ ] No public generated origin on the services, or direct requests refused.
      Verify: a request to the Railway domain fails while Cloudflare's health check
      still passes.
- [ ] Exactly one chain-worker replica, and an alert if that changes.
- [ ] `scripts/sync-railway-env.ts` run with the reviewed per-service credential
      lists; `--prune` removes anything stale.
- [ ] Migrations through 0057 applied before the dashboard API starts.

## 3. Keys and custody

- [ ] No raw production private key in an environment variable: the order signer
      in Turnkey or KMS, the operator key (x402 broadcasts, treasury sweeps) in a
      custody provider with a policy that names chain, contract, selector, token
      and amount.
- [ ] Treasury and merchant-facing destination addresses are multisigs.
- [ ] `PaymentRouter` roles: guardian holds `GUARDIAN_ROLE` only (pause);
      `CONFIG_ROLE`, including `unpause`, sits behind the timelock with multisig
      owners; checked on-chain, not assumed.
- [ ] Each `PaymentRouter` chain has a recorded deployment and the router
      allowlist matches it.

## 4. Repository and delivery

- [ ] Branch protection on `main` with `ci` and `security` required and code-owner
      review on (`.github/CODEOWNERS`).
- [ ] Secret scanning and push protection on.
- [ ] The `osv-scanner` advisories triaged, then the job made blocking.
- [ ] The exact commit being deployed reviewed, per the gate in
      [deployment.md](./deployment.md#mainnet-gate).

## 5. Exercised, not only configured

- [ ] A testnet drill for each runbook that matters on day one: pause and unpause,
      signer rotation through the timelock, API key and webhook secret rotation,
      session revocation, a stuck refund.
- [ ] A database restore from backup into an empty instance, with the time it took.
- [ ] Alerts firing for: `refund-discrepancy` log lines, 401/403/429 spikes,
      worker lag, pause events, withdrawals, and any signer activity.
- [ ] Independent audit of the contracts and the off-chain settlement, refund and
      custody paths, with no open critical or high finding.
- [ ] A penetration test of the dashboard, both APIs, the checkout and embed, and
      webhooks.

## 6. Launch posture

- Start with small `MAX_PAYMENT_SETTLEMENT` and `MAX_MERCHANT_DAILY_SETTLEMENT`
  and raise them only after reconciliation (`refund-discrepancy`, ledger balance)
  has been clean for a while.
- Few merchants, known to you, at first.
- A named person signs the final go/no-go and the risks left open are written down.

## Known gaps at the time of writing

Things the code does not do yet, so the checklist cannot be completed by
configuration alone:

- No durable nonce outbox: a dropped operator transaction needs a manual replacement.
- Payer-facing routes authorise on holding the payment id; there is no separate
  scoped, expiring token (SEC-09).
- The admin surface is one static token; it can be limited to a hostname but is not
  short-lived or scoped (SEC-14).
- No password-change flow, no session inventory, no WebAuthn.
- Webhook secrets from before encryption stay plaintext until rewritten.
- Webhook delivery has no egress proxy; the pin is in the application.
- No KMS-backed encryption of secrets at rest, no key versioning.
