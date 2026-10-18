[← Documentation index](./README.md)

# Incident Runbooks

First responses for the incidents the mainnet security programme (#143) names.
Written from the code and the other documents here; **no drill has been run
against any of them**, and the RFC does not count a runbook as done until one
has (SEC-22). Where a step needs a platform console (Railway, Cloudflare,
Turnkey, the multisig), it says so rather than naming a command that does not
exist here.

Order of work in every incident: **stop the loss, preserve evidence, rotate,
then investigate.** Pausing and revoking are cheap and reversible; rotating
secrets is not, so do it second.

The one cross-cutting tool is the security event log: every mutation and every
401/403/429 on both APIs is one JSON line (`"type":"security"`) with actor,
tenant, route and a request id that is also the `x-request-id` response header
(`packages/http/src/security-events.ts`). The admin surface has its own
append-only trail (`admin_audit_events`).

---

## Signer compromise (order-signing key)

The `PaymentRouter` trusts one `signer`. Whoever holds the key can authorise
settlement destinations and refund recipients.

1. **Pause the router now**: `pause()` as `GUARDIAN_ROLE`, on every chain the
   router runs. Pause blocks new pays and moves no funds. The guardian cannot
   unpause (`CONFIG_ROLE`, behind the timelock).
2. Stop the API processes that sign (platform console), so no new order is
   signed with the old key while you rotate.
3. Create the new key in the custody provider; note its address.
4. Schedule `setSigner(newAddress)` through the `TimelockController` with
   multisig approval (**48 h delay**; `scripts/rotate-router-signer.ts`,
   [quote-signing.md](./quote-signing.md#rotation)). If the multisig itself is
   suspect, the guardian can cancel a malicious queued operation.
5. After execution, cut the backend over to the new key, then `unpause()`
   through the timelock.
6. Review `SettlementExecuted`/refund events since the suspected start for
   destinations that are not a registered merchant address.

## Refund anomaly

The database refuses a refund that would take the non-failed total past the
payment's net amount (`refunds` trigger, migration 0055), so the failure to look
for is a refund to the wrong place or a stuck one, not an over-refund.

1. Find the caller: search the security log for `POST /v1/payments/:id/refunds`
   by `tenant`/`actor`.
2. Deactivate the API key that issued it (dashboard `DELETE /v1/api-keys/:id`,
   MFA step-up) or remove its `refunds:manage` permission.
3. A refund stuck between the rail and the ledger is finished by the chain
   worker (`resumePending`, at start and every 5 minutes). Do not re-issue it by
   hand: the rail call is keyed by the refund id.
4. Compare `refunds` against the ledger postings for the same transaction; there
   is no automated report yet.

## API key or webhook secret leaked

- **API key:** deactivate it in the dashboard, issue a new one. Requests with it
  stop at the next lookup; the per-key rate limit does not matter once it is off.
- **Webhook signing secret:** rotate the endpoint
  (`POST /v1/webhooks/endpoints/:id/rotate`, MFA step-up). The old secret keeps
  verifying for 24 h so receivers can switch, then the dispatcher erases it. If
  the old one is the leaked one, deactivate the endpoint instead and recreate it.

## Dashboard account or session compromise

1. `POST /v1/auth/sessions/revoke-others` from a trusted session signs out every
   other device. Turning the second factor on or off does the same.
2. Sessions also die after `SESSION_IDLE_SECONDS` (default 1 h) unused.
3. Check what the account did: security log by `actor`, and the settings and
   withdrawal trails. Withdrawals to a new destination wait 24 h and are capped
   per rolling day, which is the window to cancel.
4. There is no password-change flow yet; resetting means changing the hash in the
   database.

## Admin token leaked

`ADMIN_TOKEN` gates the admin routes (market config, webhook operations, x402
resources). It is one static bearer.

1. Replace `ADMIN_TOKEN` on the payment API service and redeploy; the old value
   stops working immediately.
2. Read `admin_audit_events` for the window: every call is recorded, allowed or
   denied, with source IP and a token fingerprint.
3. If `PUT /v1/admin/market-config/*` was used, review `GET` of the config
   against the last known good: a writable feed map is a writable price.

## Database credential or data compromise

1. Rotate the database credentials in the platform console. The least-privilege
   roles (`scripts/db-roles.ts`, #362) are created but **not yet wired into the
   services**, so today every service shares the super-credential: rotating it
   means redeploying all three.
2. The ledger, event log, withdrawals and audit trails are append-only in the
   database, so a compromised service credential cannot rewrite them quietly.
   Verify that is still true (`forbid_row_mutation` triggers present).
3. Restore is not rehearsed and backups are not defined (SEC-20); treat a
   destructive incident as unrecoverable until that is done.
4. Sessions and CSRF values are hashed at rest, API keys are hashed, webhook
   secrets are **not** (plaintext): rotate every webhook secret.

## Chain worker or nonce trouble

The worker holds a Postgres advisory lease; a second replica waits, and a worker
that loses the lease exits. Nonces come from a shared Postgres sequencer.

1. Stop the worker (platform console) before touching anything.
2. Check for a stuck transaction from the operator key; the sequencer has a 60 s
   floor and **no replace/finalise recovery** (SEC-04), so a dropped
   transaction means a manual replacement from that key.
3. Restart one replica. Deposits are keyed by `(chain, tx_hash, log_index)`, so a
   re-scan is safe.

## Rotating a deposit-forwarder destination

`DepositForwarder.destination` is immutable and every deposit address is a
function of the factory address, salt and `INIT_CODE_HASH`
([contract-review.md](./contract-review.md)). A new destination is a new
factory.

1. Deploy the new factory with the new destination; record its address.
2. Point new payments at it. **Keep the old factory's addresses monitored**: a
   payer can still send to a deposit address already issued, and funds sent
   there can only ever reach the old destination.
3. Sweep whatever has accumulated at old addresses to the old destination while
   it is still controlled. If it is the compromised side, those funds are the
   incident.
4. Never reuse a factory address and salt on a chain with a different
   destination: the deposit address would be the same.

## Malicious dependency

1. `security.yml` reports advisories in `bun.lock` (report-only today) and
   `gitleaks` scans history. Neither detects a freshly poisoned release.
2. Pin the previous lockfile, redeploy, and rotate every secret the affected
   service held. `scripts/railway-env-policy.ts` lists which credentials each
   service holds, which bounds the set.
3. Dependencies here are updated by hand, so the lockfile diff in the offending
   PR is the first place to look.

## Cloudflare or Railway outage

Nothing here fails over. Payments in flight stay safe on-chain: the contract path
settles in the payer's own transaction, and the deposit path is picked up by the
worker's re-scan after recovery. The payer-facing symptom is a checkout that does
not load; there is no status page yet.
