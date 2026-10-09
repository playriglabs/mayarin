# Mayarin Payment Router — Solana

Anchor/Solana implementation of the core invariants in the EVM
[`PaymentRouter.sol`](../payment-router/src/PaymentRouter.sol).

## Preserved behavior

- A backend-authorized order locks the settlement mint, `min_out`, fee, merchant,
  refund recipient, and deadline.
- A successful payment permanently creates
  `PDA("intent", config, intent_id)`, making the intent non-replayable. Any
  failure rolls the account creation and token movements back atomically.
- The merchant receives exactly `min_out - fee`; treasury receives `fee`; swap
  output above `min_out` goes to the payer's refund account.
- Input, settlement mint, and swap-program allowlists are PDA accounts controlled
  by the configured admin.
- Cross-asset execution measures output and residue against per-call token-vault
  baselines. The program returns residue and rejects a non-zero delta.
- The guardian can pause immediately. Configuration remains with the admin,
  which should be a governance/timelock-controlled address in production.

## Solana-native differences

There is no Permit2 or EIP-712 on Solana. The payer signs the transaction and
authorizes SPL Token transfers directly. Backend authorization is a standard
Ed25519 precompile instruction placed immediately before `pay_spl` or
`pay_spl_with_swap`; the router inspects that already-verified instruction.
Native SOL payments use wrapped SOL as the input mint, which keeps the swap and
residue path inside the SPL Token accounting model.

The exact signed bytes are:

```text
"MAYARIN_PAYMENT_ORDER_V1"
|| program_id[32]
|| config_pda[32]
|| deployment_domain[32]
|| intent_id[32]
|| settlement_mint[32]
|| min_out_u64_le[8]
|| fee_u64_le[8]
|| merchant[32]
|| refund_to[32]
|| deadline_i64_le[8]
```

`deployment_domain` must be a distinct, non-zero 32-byte value per cluster and
deployment. Together with the program ID and config PDA it replaces the EIP-712
chain/domain replay boundary.

`pay_spl` is the same-asset no-swap path. `pay_spl_with_swap` transfers the
input into PDA-owned vaults, invokes an allowlisted program using the supplied
route instruction data and remaining accounts, and then verifies the measured
settlement output. The route must name the PDA-owned input and settlement vaults
in its remaining accounts. Only the router-authority PDA is forwarded as a
signer during CPI; payer or other transaction-signer privileges are deliberately
removed.

The router supports both the legacy SPL Token program and Token-2022, including
mixed-program input/settlement routes. Mints with a non-zero transfer fee or an
enabled transfer hook remain unsupported because they can change exact merchant
receipt semantics or require mint-specific extra accounts.

## Build and test

```bash
cd packages/contracts/solana-payment-router
cargo test --workspace
anchor build
```

The API exposes a Solana contract checkout as `kind: "solana"` with zero or more
base64 `preparationTransactions` followed by the base64 payment `transaction`.
The payer wallet signs and submits them in that order. Preparation creates any
missing associated-token accounts and, for native SOL input, wraps only the
missing WSOL amount. Same-asset payments use a legacy transaction. Cross-asset
payments use a v0 transaction plus address lookup tables so Ed25519 verification
and the allowlisted swap remain atomic under Solana's transaction-size limit.

The checkout layer accepts a chain-scoped `SolanaRouteSource`. The provider
package includes an Orca Whirlpool SwapV2 adapter, selected by the payer mint
and the order's chosen settlement mint. No mock DEX or local liquidity program
is included.

`Anchor.toml`, `declare_id!`, and the checked-in devnet metadata all pin the same
program address; changing it requires regenerating the program keypair and
updating all three together.

## Devnet deployment

The payment router is deployed on Solana devnet at
`5raasGCxqaEvGsvQ1PvGxRB1JYnA7Y3L4LfjRCfkNJ4f`. Its upgrade authority is the
gitignored local key `.keys/solana-devnet-deployer.json`; public deployment
metadata is recorded in `deployments/devnet.json`.

The primary devnet allowlist accepts native SOL through WSOL, Circle devnet USDC
(`4zMMC9...DncDU`), and Paxos sandbox USDG (`4F6PM9...T5BP7`). USDC and USDG
are both settlement assets. The router also allowlists Orca's official
devPYUSD/devUSDC fixture mints and the verified Whirlpool program so the swap
path can be exercised against real devnet liquidity. Fixture mints do not
replace the primary asset identities in `CHAIN_ASSETS`.

Reconcile the on-chain allowlist idempotently with:

```bash
bun run --cwd packages/providers/solana configure:devnet
```

Run the real DEX end-to-end check with:

```bash
bun run --cwd packages/providers/solana e2e:orca:devnet
```

The check acquires devPYUSD through Orca when necessary, signs a Mayarin order
that explicitly chooses devUSDC settlement, submits the atomic router-to-Orca
CPI, and verifies the destination token balance. The persistent v0 lookup table
is recorded in `deployments/devnet.json` and configured through
`SOLANA_ORCA_LOOKUP_TABLES`.

The deployed config is initialized with a distinct order signer, the devnet
deployer as guardian and fee recipient, and a non-zero deployment domain.
Same-asset primary USDC/USDG payments are ready once a merchant payout key and
funded payer are configured. Cross-asset settlement for the exact Paxos USDG
and Circle USDC mints requires a compatible live pool; the Orca fixture proves
the complete DEX path without pretending its test mints are those assets.

For deposit-match payments, the deterministic deposit owner signs the router
transaction after the watcher confirms the transfer. The backend order signer
funds that owner with only the SOL needed for the transaction and the
`consumed_intent` account; it never becomes the token authority. A successful
worker pass therefore pays the merchant ATA on-chain before the clearing state
can reach `SUCCESS`.
