[← Documentation index](./README.md)

# Mainnet Launch Checklist

What has to be true before real money moves, in the order to do it. It collects
the work tracked in the security programme (#143) into one list; the RFC stays
the authority on what each item means and what is still open.

A ticked box means the thing is **implemented and tested in this repository**. It
does not mean it has been done on a mainnet: each ticked item still has an
**On mainnet** step, done and checked when the mainnet is built. Boxes for actions
(create a project, apply a migration, hold an audit, run a drill) stay empty until
someone has done them.

Status below follows #143 as of 20 October 2026. Nothing is deployed to mainnet:
Ethereum, Base, Arbitrum One, Polygon and BNB Smart Chain are the mainnet chains the
code knows (`MAINNET_CHAIN_IDS`), and every contract and payment drill so far ran on testnet.
Of the items below, 9 are implemented and none is done on a mainnet.

The deployment mechanics are in [deployment.md](./deployment.md#mainnet-gate).
Incident procedures are in [runbooks.md](./runbooks.md).

## 1. The code refuses to boot unfinished

These are enforced at start-up, so a missing one is a failed deploy rather than a
quiet gap. Set all of them on the payment API:

| Variable                        | What it does                                                                                                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MAX_PAYMENT_SETTLEMENT`        | Largest single payment per settlement asset. Required with any mainnet chain.                                                                                              |
| `WEBHOOK_SECRET_ENCRYPTION_KEY` | Encrypts webhook signing secrets in the database. Required with any mainnet chain. Same value on the dashboard API.                                                        |
| `WEBHOOK_SECRET_PREVIOUS_KEYS`  | Only during a key rotation: the old key, so rows sealed under it still open. Set the new key above, run `bun run db:rotate-webhook-secrets`, then empty this on both APIs. |
| `PAYER_TOKEN_KEY`               | Signs the payer's link token (SEC-09). Required with any mainnet chain. Same value on the dashboard API. Rotating it revokes every payer link: that is the incident lever. |
| `INTERNAL_API_TOKEN`            | Lets the dashboard API read payments without a payer token. Required with any mainnet chain. Same value on the dashboard API, which will not boot without it.              |
| `CHAIN_ASSETS` / market config  | Only tokens in `packages/core/chain/src/reviewed-tokens.ts` are accepted on mainnet chains (Base USDC, USDT and EURC; Polygon USDC and USDT; Arbitrum USDC and USDT).      |
| `QUOTE_SIGNER`                  | `local` is refused for a mainnet router: use `turnkey` or the AWS KMS signer.                                                                                              |
| `OPERATOR_SIGNER`               | A raw `OPERATOR_PRIVATE_KEY` is refused when a mainnet chain is configured: use `turnkey` (#417) or `aws-kms`.                                                             |
| `TREASURY_EXECUTION_ENABLED`    | On for the chain worker and **off for core-api**: one operator key, one nonce lane. See [execution topology](#3-execution-topology).                                       |

Optional but part of the launch posture:

- `MAX_MERCHANT_DAILY_SETTLEMENT`: rolling 24-hour ceiling per merchant and asset.
- `OPERATOR_FLOAT_LIMITS`: makes the chain worker log a JSON line when the operator
  holds more than its ceiling or less gas than its floor (#423). It does not sweep.
- `ALLOWED_HOSTS`: the public hostnames; any other `Host` is a 404. `/health` is exempt.
- `ADMIN_ALLOWED_HOSTS`: where `/v1/admin` answers (a private name); list it in `ALLOWED_HOSTS` too.
- `ORIGIN_AUTH_SECRET`: a secret only the edge adds as `x-origin-secret`; without it a request is a 404, so the Railway domain is no way around Cloudflare. Same value on both APIs; set it at the edge first (`origin-authentication.md`).
- `API_KEY_RATE_LIMIT_REQUESTS`: per-key budget (default 600 per window).
- `SESSION_IDLE_SECONDS`: dashboard idle sign-out (default 3600).
- `AUTO_RETURN_ENABLED` (default `false`) and `AUTO_RETURN_GRACE_SECONDS` (default 3600): on the chain worker
  only. Sends a failed deposit-match payment's deposit back to the `returnAddress` the payer named on the rail,
  once the payment has been failed for the grace period. See `runbooks.md`, "A payment failed after the payer's
  deposit arrived".

## 2. A mainnet that shares nothing with testnet

- [ ] New Railway project, database, domains, RPC credentials, signers, Turnkey
      organisation and policies, webhook keys, API/session secrets. Nothing copied
      from testnet.
- [x] Database not reachable from the internet; each service on its own role
      (`scripts/db-roles.ts`), and the roles wired into the service connection
      strings. Migrations applied by a separate short-lived role. Implemented and
      tested on Postgres (`service-roles.postgres.test.ts`). **On mainnet:** create
      the roles, wire the connection strings, close the public endpoint.
- [x] No public generated origin on the services, or direct requests refused.
      Implemented as `ORIGIN_AUTH_SECRET` (`packages/http`, tested; off by default).
      **On mainnet:** set it at the edge first, then on both APIs, and verify that a
      request to the Railway domain fails while Cloudflare's health check still
      passes.
- [ ] Exactly one chain-worker replica, and an alert if that changes. A second
      replica waits on the worker lease and a worker that loses it exits (#359), and
      each lease takes a fencing token the nonce sequencer checks before it
      broadcasts (#419); there is still no alert on drift.
- [x] `scripts/sync-railway-env.ts` with the reviewed per-service credential lists;
      `--prune` removes anything stale, and it fails on a credential with no
      reviewed decision. Implemented. **On mainnet:** run it against the mainnet
      project.
- [ ] Every migration applied, through 0064, before any service of the new version
      starts. The recent ones that bite when missing: 0058 and 0061 (the operator
      transaction log and fee bumps, needed by the chain worker), 0062
      (`login_failures`, without which every login is a 500), 0063 (worker
      fencing), 0064 (fraud rules).

## 3. Execution topology

How value is executed matters as much as the keys that execute it.

- Only the **chain worker** holds the treasury executor and the operator key.
  core-api keeps `TREASURY_EXECUTION_ENABLED=false`: a deposit it records stops at
  `ASSET_RECEIVED` and the worker finishes it on its next pass (every 30 s).
  Locally both read one `.env`, so `apps/api`'s dev script forces the flag off for
  the API alone; switching it off in the shared file leaves no executor anywhere.
- The engine skips a signal-less pass over a payment this process is already
  stepping, so the worker's own recovery timer cannot submit an order twice while
  the first is waiting on its confirmations. Another process is covered only by
  the chain.
- A payment whose intent the router already consumed is finished, not failed: the
  executor asks the router `consumed(intentId)` before sending anything, and reads
  what the earlier transaction did from the settlement indexer (then a bounded log
  search). **Retry settlement** on such a payment answers 202 and the worker
  finishes it. This was proven once, on Polygon Amoy, on 20 October 2026.
- The indexer's row is what lets that recovery answer however late the retry is.
  On a chain where the indexer is not running it falls back to a log search
  reaching back 2000 blocks, so a retry hours later would fail as before.

## 4. Keys and custody

- [ ] No raw production private key in an environment variable: the order signer
      in Turnkey or KMS, the operator key (x402 broadcasts, treasury sweeps) in a
      custody provider with a policy that names chain, contract, selector, token
      and amount. `OPERATOR_SIGNER` is `turnkey` or `aws-kms`, and the quote-signer
      rule is enforced. The Turnkey policies are written and not yet applied to an
      organisation, and `scripts/turnkey-operator.ts selftest` has not been run against
      one; the KMS route has no policy on what is signed (see below). Still
      raw in the environment and **not** refused on mainnet:
      `SOLANA_ORDER_SIGNER_SECRET_KEY`, `SOLANA_DEPOSIT_SEED`,
      `WALLET_DEPLOYER_PRIVATE_KEY`. Either move them or leave Solana and merchant
      wallet provisioning off on mainnet.
- [ ] **KMS instead of Turnkey** (the unpaid route): two AWS KMS keys, never one, each
      `ECC_SECG_P256K1` / `SIGN_VERIFY`: the order signer (`QUOTE_SIGNER=aws-kms`,
      `AWS_KMS_KEY_ID`) and the operator (`OPERATOR_SIGNER=aws-kms`,
      `OPERATOR_AWS_KMS_KEY_ID`). The config refuses one key for both, and a raw
      operator key beside either. `scripts/aws-kms-addresses.ts` reads each key's
      address from its public key into `mainnet-addresses.json`, and with
      `--sync-env` fills `SIGNER`, `AWS_KMS_SIGNER_ADDRESS`, `DESTINATION` and
      `OPERATOR_ADDRESS`; `--selftest` signs once with each key and checks it recovers to
      its own address, which proves the identity running it may call `kms:Sign`. The
      operator account signs transactions and typed data (Permit2) and refuses a raw
      message, and a transaction it signs is byte for byte the one a plain local key signs
      (tested). Implemented and tested against a stand-in KMS. **On mainnet:** create the
      two keys and an alias for each, then one IAM identity per service with `kms:Sign`
      and `kms:GetPublicKey` on that service's key only (core-api: the order signer;
      chain-worker: the operator), nothing that schedules deletion or changes a key
      policy, and CloudTrail alerts on every `Sign`, `ScheduleKeyDeletion` and
      `PutKeyPolicy`. The AWS credentials are the SDK's (`AWS_ACCESS_KEY_ID` and
      `AWS_SECRET_ACCESS_KEY`, or a role), set in Railway by hand per service and never in
      a file.
      **What KMS does not do:** Turnkey's policy engine refuses a transaction to a
      contract that is not ours, and KMS cannot look inside one. A process that is
      compromised while it holds the role can ask KMS to sign anything, and cannot take
      the key away. The bounds are IAM (only that role), CloudTrail (every signature
      is logged), and the float at the operator address (`OPERATOR_FLOAT_LIMITS`): keep
      only the gas and the sweep in flight there. This does not meet the SEC-06 line
      about a policy on selector, token and amount; it is the chosen trade for not paying.
- [x] Treasury and merchant-facing destination addresses are multisigs.
      `scripts/deploy-treasury-safe.ts` deploys a threshold Safe on the canonical
      Safe 1.4.1, refuses a threshold under 2 and any key a service holds, and
      reads the owners back from the chain. Implemented. **On mainnet:** deploy the
      treasury Safe and record its owners.
- [x] `PaymentRouter` roles: guardian holds `GUARDIAN_ROLE` only (pause);
      `CONFIG_ROLE`, including `unpause`, sits behind the timelock with multisig
      owners. Implemented and tested (`Admin.t.sol`). **On mainnet:** checked
      on-chain, not assumed. After every deploy read
      `hasRole(CONFIG_ROLE)` for the timelock, the deployer and the guardian,
      `signer()` against the order-signing address, and the whitelists.
- [ ] Each `PaymentRouter` chain has a recorded deployment (address, block,
      `INIT_CODE_HASH`, in `docs/chain.md`) and the router allowlist matches it.
- [x] Settlement destination registry, implemented (#425, `MerchantRegistry.t.sol`).
      **On mainnet:** roll it out as `destination-registry.md` says: registrar key that is not the quote signer, every merchant registered,
      then enforced, all through the timelock. Do not enforce on a chain that
      offers escrow. New merchants must be registered before their first payment.

## 5. Contracts for mainnet

- [ ] **The build is frozen before the audit.** Solc 0.8.37, via-IR, `cancun`,
      optimizer 200 runs. A different compiler, optimizer or source changes the
      forwarder `INIT_CODE_HASH` and every CREATE2 address (escrow factories, payout
      batcher), which forks the deposit address space: addresses already shown to
      payers can no longer be swept by a factory built from the new code. On
      testnet that was a redeploy on 20 October 2026; on mainnet it is a migration.
      A redeploy also changes the EIP-712 domain, so every signed order is void.
- [ ] Timelock delay left at its **48 h default**. The testnet `.env` sets
      `TIMELOCK_DELAY=0`; do not carry that over. `MULTISIG` is a real multisig,
      `GUARDIAN` a separate holder, `FEE_RECIPIENT` the treasury Safe, `SIGNER` the
      Turnkey or KMS signer's address, and `DESTINATION` (the operator every forwarder
      sweeps to) is its own production address: it is baked into the forwarder's init
      code, so it decides the hash for this deployment.
- [x] `scripts/deploy.sh` has a mainnet mode for `base`, `arbitrum`, `polygon` and
      `bsc`. It reads `.env.mainnet` (never the testnet `.env`), deploys from a
      Foundry keystore (`DEPLOYER_ACCOUNT`, not a raw key), keeps the 48 h delay,
      refuses a deployer that holds a role, a `GUARDIAN` equal to `MULTISIG`, a
      `MULTISIG` or `FEE_RECIPIENT` without code (they must be Safes), a `local`
      order signer, `--no-verify` and a missing explorer key, and asks for the chain
      name before it broadcasts. Rehearsed on local forks of all four chains.
      **On mainnet:** the configure step only **schedules** (the router whitelists,
      DEX routers and extra input or settlement assets, land in one batch): the
      delay runs from the schedule, not from the deploy, so schedule it right after
      the deploy. `ConfigurePaymentRouter` prints the `scheduleBatch` and
      `executeBatch` calldata for the Safe to sign; for a single-key multisig,
      `ExecutePaymentRouterConfig` rebuilds the same batch, refuses until it is
      ready (and says when), then executes. Same-asset payments in a settlement
      asset the constructor whitelisted work before the batch executes; anything
      needing a DEX waits for it.
- [ ] Compare the target chain's gas before broadcasting. Ethereum Sepolia's
      `eth_estimateGas` for the router's creation was 18.5M against 2.7M on Base, so
      forge's own estimate ran out of gas and the transaction failed with all gas
      used. Check `cast rpc eth_estimateGas` against what forge plans; pass
      `FORGE_EXTRA_FLAGS="--gas-estimate-multiplier N"` (the configure step takes it
      too, and `--configure-only` repeats that step without a second deploy).
- [ ] Verify on the explorer right after the deploy, not only on the deployer's
      word, with `forge verify-contract` and `--guess-constructor-args --watch`.
      An explorer that has not indexed the contract yet answers "runtime bytecode
      does NOT match"; wait and repeat. Arc's explorer rate-limits verification
      altogether. `deploy.sh` asks Etherscan V2 about the chain before it broadcasts
      and refuses if the key's plan does not cover it: the free plan covers Arbitrum
      One and Polygon but **not Base or BNB Smart Chain**, which need a paid plan.
      The free route is Sourcify, set per chain in `.env.mainnet`
      (`BASE_EXPLORER_VERIFIER=sourcify`, `BSC_EXPLORER_VERIFIER=sourcify`; no key;
      `EXPLORER_VERIFIER` sets it for all). Sourcify verifies this repository's
      contracts with an exact match (checked on the router, the OpenZeppelin timelock
      and the forwarder factory), but the explorer's own page may not show the source.
- [x] A chain's deposit-match path is only as good as the single
      `DEPOSIT_FORWARDER_INIT_CODE_HASH`: the deploy script aborts when a chain's
      factory reports a different one. Implemented. Do not override it.
- [x] Token decimals checked on chain (`decimals()`), not assumed: the domain
      counts stablecoins in 6, and BNB Smart Chain's are 18. The conversion is
      implemented and tested (`token-units`). **On mainnet:** read `decimals()` of
      every admitted token before it goes in `CHAIN_ASSETS`.

## 6. Mainnet chains

Ethereum, Base, Arbitrum One, Polygon and BNB Smart Chain are the mainnets the code
knows (`MAINNET_CHAIN_IDS`). Their reviewed stablecoins, each read back from its chain
(`symbol()`, `decimals()`, code present):

| Chain           | Reviewed tokens                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| Ethereum        | USDC, USDT, EURC (6 decimals), DAI (18); payer-only WETH, WBTC, LINK, UNI, AAVE                              |
| Base            | USDC, USDT (Tether, bridged), EURC; payer-only WETH, cbBTC                                                   |
| Arbitrum One    | USDC, USDT (USDT0), USDG (6 decimals), DAI (18); payer-only WETH, WBTC, ARB, LINK, UNI, AAVE                 |
| Polygon         | USDC (Circle native), USDT (USDT0), 6 decimals; payer-only WETH, WBTC                                        |
| BNB Smart Chain | USDC, USDT, DAI, FDUSD, all **18 decimals** (`token-units`); payer-only WBNB, BTCB, UNI, CAKE. BNB is native |

Ethereum is the dearest chain to be wrong on and, at 0.05 gwei, the cheapest it has been:
the whole first deploy costs under a dollar and one deposit-match payment about five
cents, but at 30 times that gas a payment costs about $1.50. The operator pays those gas
fees and recovers them from the payer's payment with `RELAYER_GAS_FEE_BASIS_POINTS`
(0.1 %), floored per chain by `RELAYER_GAS_FEE_MINIMUMS`. The percentage alone covers a
$100 payment at today's gas and loses money past about five times it; the floor is what
keeps a small payment, or a dear hour, from costing Mayarin. A mainnet router chain
without a floor will not boot. The floor is a fixed number you set, not the live gas
price, so re-read it against the chain's gas before launch and when gas moves. Finality takes about 13 minutes; the starting
`CHAIN_CONFIRMATIONS` is 12 (about 2.5 minutes).

Polygon's USDT address now answers as **USDT0**, a LayerZero OFT that is Tether's
own token. It was admitted on 20 October 2026 knowing it is upgradeable and can be
frozen, and that its `symbol()` reads `USDT0`. Polygon's bridged USDC.e is a
different token and is left out on purpose. Base's USDT (`0xfde4…9bb2`, 6 decimals) is
Tether's bridged token, with about $29.5 million in supply: thin, so treat it as a
settlement option and not as a venue. On BNB
Smart Chain the tokens are Binance-Peg, not Circle's or Tether's own issuance:
accept that before admitting them. Each chain still needs, before it carries value:

- its own `CHAIN_CONFIRMATIONS` and `WATCHER_REORG_WATCH_WINDOW` from observed
  reorg behaviour, not another chain's values (BNB Smart Chain's blocks are under a
  second, Polygon's reorg more than Base's), and a watcher range its RPC allows;
- a swap venue if cross-asset payments are wanted there, and an oracle for each
  non-stablecoin payer asset. None is configured: each chain settles same-asset only;
- the Safe addresses (`MULTISIG`, `FEE_RECIPIENT`) and a Turnkey organisation;
- `scripts/mainnet-wallets.sh` writes every address that exists to
  `mainnet-addresses.json` at the repo root (mode 600, gitignored) without printing
  one: the deployer, the roles already set, and the contract addresses each chain
  will get (timelock, router, forwarder factory, predicted from the deployer's nonce).
  `--guardian` and `--owners N` also create encrypted keystores with `cast wallet new`
  (password prompt, interactive), `--adopt <name>` records a keystore made earlier,
  and `--sync-env` fills the blank `GUARDIAN`, `MULTISIG`, `FEE_RECIPIENT` and
  `TREASURY_ADDRESS` of `.env.mainnet` from the file without printing them. It makes
  no order signer or operator (Turnkey or KMS). `scripts/mainnet-safes.sh` predicts,
  and with `--execute` deploys, the two Safes (the multisig and the treasury, a
  threshold of the `safe-owner-*` keystores, one address on every chain, a different
  address for each) and records them in the same file; the deploy asks for a typed
  word and pays gas with the deployer keystore, decrypted into one process only;
- a `.env.mainnet` with `DEPLOYER_ACCOUNT`, `DEPLOYER_ADDRESS`, the per-chain
  `<CHAIN>_RPC_URL` (`ETHEREUM_`, `BASE_`, `ARBITRUM_`, `POLYGON_`, `BSC_`), `MULTISIG`,
  `GUARDIAN`, `FEE_RECIPIENT`, `SIGNER`, `DESTINATION`, `ETHERSCAN_API_KEY`,
  `QUOTE_SIGNER` (not `local`), and `CHAIN_ASSETS` naming only the reviewed tokens.

Adding a fifth mainnet chain takes an entry in `MAINNET_CHAIN_IDS`, its reviewed
tokens, the chain's id, label and explorer in `packages/core/chain`, the viem chain
and a case in `deploy.sh`.

## 7. Repository and delivery

- [ ] Branch protection on `main` with the four CI jobs required: `check`,
      `committed secrets`, `contract tests and Slither` and
      `known vulnerabilities in bun.lock`. Code-owner review on
      (`.github/CODEOWNERS`). They run on every pull request today but nothing
      makes them mandatory.
- [ ] Secret scanning and push protection on.
- [ ] The `osv-scanner` advisories triaged, then the job made blocking.
- [ ] The exact commit being deployed reviewed, per the gate in
      [deployment.md](./deployment.md#mainnet-gate).

## 8. Exercised, not only configured

- [ ] A testnet drill for each runbook that matters on day one: pause and unpause,
      signer rotation through the timelock, API key and webhook secret rotation,
      session revocation, a stuck refund. None has been exercised.
- [ ] An end-to-end payment on every chain and path that will carry value: the
      contract path and the deposit-match path, each settled once, with the
      amount read back on chain. So far: deposit-match on Polygon Amoy, once. The
      contract path on Amoy and BSC testnet, and anything on BNB Smart Chain's
      18-decimal tokens, are untested on chain.
- [ ] Duplicate workers, a crash after each broadcast, a reorg, an RPC that
      disagrees about a block hash, and a nonce replacement, each driven against a
      testnet. Several are tested against Postgres or the watcher; the two-node
      disagreement is not.
- [ ] A database restore from backup into an empty instance, with the time it took.
- [ ] Alerts firing for: `refund-discrepancy` log lines, 401/403/429 spikes,
      worker lag, pause events, withdrawals, operator float, stuck or unrecorded
      operator transactions, and any signer activity.
- [ ] Independent audit of the contracts and the off-chain settlement, refund and
      custody paths, with no open critical or high finding.
- [ ] A penetration test of the dashboard, both APIs, the checkout and embed, and
      webhooks.

## 9. Launch posture

- Start with small `MAX_PAYMENT_SETTLEMENT` and `MAX_MERCHANT_DAILY_SETTLEMENT`
  and raise them only after reconciliation (`refund-discrepancy`, ledger balance)
  has been clean for a while.
- Few merchants, known to you, at first.
- A named person signs the final go/no-go and the risks left open are written down.

## Known gaps at the time of writing

Things the code does not do yet, so the checklist cannot be completed by
configuration alone. Each is tracked in #143.

- **Operator transactions.** Every nonce is recorded and a stuck transaction that
  kept its call is re-sent under the same nonce at +12.5% fees, at most three times
  (#395, #401). A crash between the broadcast and the hash write is only seen later,
  as `unrecorded`, and x402 facilitator sends are not bumped.
- **Payer links.** The payer-facing routes need a signed token bound to one
  payment that expires after 30 days (#394). There is no per-token revocation:
  rotating `PAYER_TOKEN_KEY` revokes all of them.
- **Admin surface.** One static token, constant-time compared, every call audited
  and restricted to a hostname; no rotation, scope, expiry or approval (SEC-14).
- **Sessions.** TOTP step-up on every privileged action but refunds; password change
  and email-code reset exist and revoke other sessions (#393). No WebAuthn, no
  `__Host-` cookies, no session inventory.
- **Webhook secrets.** AES-256-GCM under `WEBHOOK_SECRET_ENCRYPTION_KEY`; rows from
  before encryption stay plaintext until `db:rotate-webhook-secrets` rewrites them.
  No KMS, no decryption audit.
- **Webhook delivery** has no egress proxy; the pin is in the application, port 443
  only.
- **Custody limits.** A per-payment ceiling, a per-merchant daily ceiling (not
  atomic), a 24 h cooling-off for a new destination and a rolling 24 h cap per
  asset exist; there are no alerts and no dual approval, and the policy is not
  enforced in the custody provider, so an API bypass would not be stopped there.
- **Escrow and the destination registry** are incompatible on one chain: an
  escrow's vault address is not a registered Safe.
- **Contract analysis.** Slither is pinned and triaged; Mythril does not finish on
  `via_ir`, and no fork test covers every admitted token.
