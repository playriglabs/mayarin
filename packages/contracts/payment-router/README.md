# @mayarin/contracts-payment-router

`PaymentRouter.sol` — the Phase 3 on-chain execution layer
([RFC #4](https://github.com/playriglabs/mayarin/issues/4)): a stateless contract
that receives the payer's asset, swaps through a whitelisted DEX router when the
assets differ, and settles `minOut − fee` to the merchant Safe in one atomic
transaction. Hard revert on `minOut` miss; zero resting balance; `intentId`
consumed on success.

Implements sub-issues #24–#28 of the RFC breakdown; the ABI export (#29 partial)
ships in the sibling `@mayarin/contracts` package. Live Base Sepolia deploy (#29
deploy step) is deferred — it needs a funded deployer key + RPC and explicit
sign-off, separate from this work.

## Architecture

Value moves in one transaction, in this order:

```
receive (native or Permit2 pull) → optional swap (whitelisted router)
  → measure settlement balance diff → split minOut−fee / fee / output−minOut
  → return residue (unconsumed input, route's native refund) to refundTo
  → assert balances back at the call's baseline → emit PaymentCompleted
```

Three invariants hold it together (specified in RFC #4, enforced and tested in
`test/Invariants.t.sol`):

- **Hard revert on `minOut` miss** — no top-up, no partial settle. This is what
  makes "merchant always receives the settlement asset" safe without a treasury
  FX book. A bad or manipulated route can only cause a revert (payer loses gas,
  never funds).
- **Zero resting balance** — the contract never custodies value. Every path sends
  all measured swap `output` out, returns unconsumed input and any native the
  route hands back to `refundTo` (`ResidueRefunded`), and then asserts its
  balances equal the **baseline captured at the start of the call**; anything
  else reverts (`RestingBalance`). There is no withdraw/sweep, by design.

  The baseline is what makes the invariant hold. Asserting absolute zero instead
  is a permanent-DoS bug: anyone can transfer tokens to any address and
  force-send ETH with `SELFDESTRUCT`, so 1 wei of USDC sent to the router would
  make every later payment revert, with no sweep and no admin path to recover —
  redeploy or nothing. Measured against a baseline, a donation is inert: never
  consumed, never counted as swap output
  (`test_donated_dust_is_not_counted_as_swap_output`), never blocking
  (`Residue.t.sol`, and the `donate` action interleaved into the stateful
  invariant). It stays stuck and unsweepable, which is the intended property.

- **Idempotent** — `intentId` is consumed (effect) before any external call, so a
  replay reverts (`AlreadyConsumed`). Cross-chain replay is blocked by the
  EIP-712 domain (`verifyingContract` + `chainId`).

Effects precede interactions (CEI): `_prepare` consumes the intent and verifies
the signature before the Permit2 pull, swap, and settlement transfers. On top of
OZ `ReentrancyGuard`, a reentrant `payEth`/`payERC20` reverts and the whole
payment rolls back — funds never move twice (`test_reentrancy_*`).

## Decisions

The open questions in RFC #4 are resolved as follows (locked before
implementation):

1. **Pause policy** — instant `GUARDIAN_ROLE` `pause()`/`unpause()`; config
   changes (router whitelist, input-asset whitelist, `feeRecipient`, `signer`)
   go through the OZ `TimelockController`. Pause can't move funds (zero resting
   balance), so timelocking it would kill the only emergency brake; the timelock
   protects the fund-adjacent surface where redirect risk lives.
2. **Timelock** — external OZ `TimelockController` holds `CONFIG_ROLE` on the
   router; the multisig is proposer + executor on the timelock. Delay **48h** in
   production, set once in the timelock constructor. Tests use a small delay +
   `vm.warp`.
3. **Route/calldata** — unsigned, caller-supplied as args to `payEth`/`payERC20`.
   The `Order` struct stays RFC-shaped (`intentId, minOut, fee, merchantSafe,
refundTo, deadline`) — no route in the signed payload. Safety: the contract
   measures the actual settlement-token balance diff after the swap and reverts
   if `output < minOut`, so an unsigned route can never settle below the lock.
4. **EIP-712 domain** — `EIP712Domain("Mayarin PaymentRouter", "1", block.chainid,
address(this))` via OZ `EIP712`.
5. **Order typehash** — `Order(bytes32 intentId, uint256 minOut, uint256 fee,
address merchantSafe, address refundTo, uint256 deadline)`.
6. **`PaymentCompleted`** — `event PaymentCompleted(bytes32 indexed intentId,
address indexed merchantSafe, address indexed refundTo, address inputAsset,
address settlementAsset, uint256 inputAmount, uint256 settledAmount,
uint256 fee, uint256 refundAmount, uint256 deadline)`. `inputAsset`/
   `settlementAsset` are `address(0)` for native. The indexer's idempotency key
   `(chain, txHash, logIndex)` comes from the log itself.
7. **Settlement math** — `output` = settlement balance diff after swap;
   `require(output >= minOut)`; merchant gets `minOut − fee`, treasury gets
   `fee`, `refundTo` gets `output − minOut`. Sum `== output` (conservation).
   `require(fee < minOut)` mirrors the clearing engine's "rejects a fee that
   would consume the whole payment" — merchant always > 0. All `uint256`,
   checked arithmetic.

   The refund is paid **in the settlement asset**, because that is the only asset
   the contract holds after the swap. This is a product-visible consequence, not
   just an implementation detail: the quote lock (#39) grosses the payer estimate
   up by `slippageBps`, so a normal fill overpays slightly and the payer receives
   the difference back as USDC even though they paid in ETH. Checkout copy and
   the payer-facing receipt need to say so.

8. **Decimals** — the contract works in raw `uint256` minor units; no decimal
   math. Cross-asset comparison happens only post-swap, in settlement-asset
   terms. This maps directly onto `Money.amount` (bigint) on the TS side.
9. **Permit2** — pulls via the canonical Permit2 address
   `0x0000000000001fF3684F28c67538d4D072C22734`; the contract declares only the
   minimal `IAllowanceTransfer` slice it calls. Unit tests use a `MockPermit2`; a
   fork test gated by `BASE_SEPOLIA_RPC_URL` (skip when unset, mirroring the
   repo's `DATABASE_URL`-gated db tests) exercises the real Permit2.
10. **Residue and `receive()`** — the contract accepts native **only from a
    whitelisted router**, because exact-output routes hand the unspent remainder
    back to `msg.sender` mid-swap (Uniswap's `refundETH`); without the hook the
    whole payment would revert inside the route. It is a pass-through, not a
    deposit: `_returnResidue` forwards it to `refundTo` in the same transaction,
    alongside any input a partial fill left behind. Both emit `ResidueRefunded`
    — additive, so `PaymentCompleted`'s shape is untouched for the Indexer (#8).
    Note the asset: residue is returned in the asset it arrived as, while
    `PaymentCompleted.refundAmount` is always settlement-asset excess above
    `minOut`.
11. **Oracle manipulation** — no on-chain oracle. `minOut` is signed by the
    backend Quote Engine (#6 composes Pyth/Chainlink + DEX off-chain). The
    on-chain defense is the signed `minOut` + hard revert; nothing on-chain to
    manipulate.

## Admin model

`CONFIG_ROLE` is held by the external `TimelockController`; `GUARDIAN_ROLE` is
held by a separate guardian (multisig). The timelock holds `DEFAULT_ADMIN_ROLE`
too, so granting a new guardian/config is itself delayed. The guardian can pause
instantly (DoS-only, recoverable via the multisig rotating the guardian through
the timelock) but cannot change config — `test_guardian_pause_only_dos_not_fund_loss`.

The 48h config delay is the one knob that bounds trust in the fund-adjacent
surface: a compromised multisig (or a key compromise on the multisig's
proposer) cannot redirect `feeRecipient` or `signer` without a full day-plus
window for the guardian/multisig membership to react and cancel. There is no
code path — admin or otherwise — by which funds can be redirected: config calls
are storage-only (`test_config_changes_move_no_funds`), and the contract exposes
no sweep, so dust sent to it is unsweepable (`test_no_sweep_dust_cannot_be_extracted`).

## Commands

```bash
forge soldeer install       # first run only — fetches forge-std into dependencies/
forge build                 # compile (solc 0.8.28, cancun, via_ir, 200 runs)
forge test                  # unit + fuzz + invariant (55 tests, 1 RPC-gated skip)
forge test --match-contract AdminTest      # one suite
forge snapshot               # write .gas-snapshot
forge snapshot --check       # CI: fail if gas changed
```

From the repo root:

```bash
bun run test:contracts       # forge test
bun run build:contracts-abi  # forge build → regenerate @mayarin/contracts ABI
bun run build:order-vectors  # regenerate vectors/order-hash.json (see below)
```

Foundry is required (not managed by bun):
`curl -L https://foundry.paradigm.xyz | bash && foundryup`.

## Security-check mapping

The pre-implementation security checklist, mapped to where it is enforced and
tested:

| Check                             | Implementation                                                                                                                                   | Test                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| ReentrancyGuard                   | OZ `nonReentrant` on `payEth`/`payERC20`; CEI (consume before external calls)                                                                    | `Invariants.t.sol` `test_reentrancy_*`                                                                                            |
| Pausable                          | OZ `Pausable`; `whenNotPaused` on pays; pause never traps value                                                                                  | `Admin.t.sol` `test_guardian_pause_instant_and_blocks_pays`                                                                       |
| SafeERC20                         | OZ `SafeERC20.forceApprove` (exact approval, reset to 0 after; avoids USDT/USDC fee-on-transfer/allowance bug); `safeTransfer` for settle/refund | `PayERC20.t.sol`, `Invariants.t.sol` approval reset                                                                               |
| Oracle manipulation               | none on-chain; signed `minOut` + hard revert                                                                                                     | `Invariants.t.sol` `test_fuzz_manipulated_route_cannot_settle_below_minOut`                                                       |
| Approval attack                   | exact `inputAmount` approval to whitelisted router, reset to 0 after; whitelist is the trust boundary                                            | `Invariants.t.sol` reentrancy handler, zero resting                                                                               |
| Wrong token / whitelist           | input-asset whitelist mapping; native always admissible                                                                                          | `PayERC20.t.sol` `test_payERC20_nonWhitelisted_asset_reverts`                                                                     |
| Exact amount (actual vs expected) | measure balance diff; `minOut−fee`/`fee`/`output−minOut` split; conservation                                                                     | `Invariants.t.sol` `invariant_no_custody_beyond_donations`, fuzz boundary                                                         |
| Donation griefing                 | resting-balance assertion is delta-vs-baseline, not absolute zero; donated dust is inert and unsweepable                                         | `Residue.t.sol` (4 donation tests + fuzz), `Invariants.t.sol` `donate` handler action                                             |
| Residue custody                   | unconsumed input and route-refunded native returned to `refundTo`; `receive()` restricted to whitelisted routers                                 | `Residue.t.sol` `test_payERC20_partial_fill_input_residue_refunded`, `test_payEth_native_refund_from_route_forwarded_to_refundTo` |
| Replay                            | `consumed[intentId]`; cross-chain blocked by EIP-712 domain                                                                                      | `PaymentRouter.t.sol` + `PayERC20.t.sol` replay, `Invariants.t.sol` `test_fuzz_replay_rejected`                                   |
| Expired quote                     | `require(block.timestamp <= deadline)`                                                                                                           | `PaymentRouter.t.sol` `test_reverts_expired_deadline`                                                                             |
| Decimal                           | raw `uint256` minor units; no decimal math; 6-dec USDC + 18-dec WETH input                                                                       | `PayERC20.t.sol` `test_payERC20_decimal_18_to_6_no_decimal_math`                                                                  |

## Static analysis

- **Foundry** — `forge build` green; `forge test` 55/55 (unit + fuzz @1000 runs +
  invariant @256×20). `forge snapshot` committed to `.gas-snapshot`.
- **Slither** (0.11.6) — `slither . --config slither.config.json`. One finding:
  `locked-ether` (Informational/Low) — the contract has a payable function and
  no withdraw. **Triaged as known-safe by design**: the zero-resting-balance
  invariant means the contract never custodies ETH, so there is intentionally no
  withdraw path. Zero untriaged high/medium. (Slither emits AST-resolution
  warnings on OZ 5.3 + solc 0.8.28 + `via_ir`; the detector pass completes — 26
  contracts, 102 detectors.)
- **Mythril** (0.24.8) — `myth analyze src/PaymentRouter.sol --solc-json
mythril-solc.json` (solc 0.8.28 via `solc-select`). Symbolic execution on a
  contract with OZ 5.3 inheritance + EIP712 + external Permit2 + low-level calls
  - `via_ir` is long-running; it compiles and starts analysis but does not
    complete within the session window. Coverage of the symbolic-execution
    concerns (reentrancy, integer bounds, idempotency) is carried by Slither plus
    the Foundry fuzz/invariant suite above. Re-run with an unbounded window for a
    full mythril pass; the invocation is recorded in `mythril-solc.json`.

## Policies

- **Solidity** is pinned in `foundry.toml` (`solc = 0.8.28`, `evm_version =
cancun` — supported on Base, the primary chain). Bump deliberately, in its
  own commit.
- **License**: MIT per-file SPDX headers. The contract source is publicly
  verified on-chain at deploy time (#29), so headers are mandatory.
- **Dependencies**: OpenZeppelin 5.3 arrives via npm
  (`@openzeppelin/contracts` devDependency, hoisted to the repo-root
  `node_modules`) with an explicit remapping in `foundry.toml` — soldeer's OZ
  registry was unavailable, so npm is the source. Permit2 is a minimal
  inline interface (`src/interfaces/IPermit2.sol`) — no Uniswap source
  dependency. `forge-std` comes through soldeer (`[dependencies]`, vendored into
  `dependencies/`, locked by `soldeer.lock`).

  `dependencies/` is gitignored, so a fresh clone must run `forge soldeer install`
  before `forge test` — CI needs that step too. If the soldeer registry is
  unreachable (it has failed with `error during IO operation: not connected`), the
  pinned artifact URL and its sha256 are both in `soldeer.lock` and can be fetched
  directly, which is what the lockfile is for:

  ```bash
  curl -sSL -o /tmp/forge-std.zip "$(grep -m1 '^url' soldeer.lock | cut -d'"' -f2)"
  shasum -a 256 /tmp/forge-std.zip   # must match `checksum` in soldeer.lock
  unzip -q -o /tmp/forge-std.zip -d dependencies/forge-std-1.9.4
  ```

  `dependencies/` is gitignored;
  `soldeer.lock` is committed.

- **Remappings** are declared explicitly in `foundry.toml`
  (`remappings_generate = false`) so the build is deterministic.

## `@mayarin/contracts` ABI export

The sibling package `packages/contracts/abis` (`@mayarin/contracts`) exports the
typed ABI and domain types downstream RFCs consume:

- `paymentRouterAbi` — the full ABI, `as const` (viem narrows signatures/topics).
- `Order` — the on-chain struct shape (matches the EIP-712 typehash).
- `PaymentCompletedArgs` / `PaymentCompletedEvent` — typed event for log decoding.
- `vectors/order-hash.json` — the #24 order-hash test vectors: type string,
  typehash, a fixed domain, a canonical order, and its struct hash and digest.

The vectors are one committed file asserted from both sides. `test/order-vectors.test.ts`
re-derives every value from the `ORDER_TYPES` that `@mayarin/quote` declares (#40);
`PaymentRouter.t.sol` `test_order_hash_vectors_match_the_exported_file` re-derives
them from `OrderHash.sol` and the EIP-712 domain formula. If the quote engine's
field list and the contract's typehash ever drift, one of the two suites fails —
instead of signatures silently failing verification on-chain.

Regenerate after any `src/PaymentRouter.sol` change:

```bash
bun run build:contracts-abi   # forge build → generate src/abi.ts
```

The generated `src/abi.ts` is committed (not gitignored) so a fresh clone
typechecks without a build step.

## CI story

Not wired yet: a CI job installs Foundry via `foundry-rs/foundry-toolchain`,
runs `forge build`, `forge test`, `forge snapshot --check`, and `slither . --config
slither.config.json`. Solidity is intentionally outside `bun run check` — the TS
pipeline stays Foundry-free, and the pre-push hook is unchanged.
