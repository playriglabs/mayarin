# Contract review notes (SEC-06, SEC-21)

An internal review of `DepositForwarder`, `DepositForwarderFactory` and a Slither
triage, 17 October 2026. It is a second pass by someone other than the author, not
the independent audit the mainnet gate requires (RFC #143).

## DepositForwarder / DepositForwarderFactory

No path lets a caller move funds anywhere but the immutable `destination`. What the
review found are constraints on how the factory is deployed and what it points at,
each now pinned by `test/DepositForwarderAdversarial.t.sol`:

- **The destination must accept native currency.** A destination whose `receive()`
  reverts makes `sweepNative` revert with `SweepFailed`. The funds stay in the
  forwarder, but `destination` is immutable, so they cannot be moved. A Safe is
  fine; an EOA is fine; a contract without a payable `receive` is not.
- **A token destination that blocks transfers strands that token.** A stablecoin
  that blacklists the destination makes `sweepToken` revert for it. There is no
  rescue path by design. Choosing a destination is therefore a one-way decision per
  factory (SEC-06: a new destination means a new factory, and the old counterfactual
  addresses must stay monitored).
- **Re-entering the sweep does nothing.** The balance is read once and sent in one
  call; a destination that calls back into `sweepNative` finds a zero balance.
- **The token argument is caller-chosen and harmless.** A hostile token can claim
  any balance or report a successful transfer; the forwarder only calls it and
  moves nothing else.
- **Do not deploy the factory at a deterministic address on several chains with
  different destinations.** `forwarderAddress(salt)` is a function of the factory
  address, the salt and `INIT_CODE_HASH` only. The same factory address and salt on
  two chains give the same deposit address even if the destinations differ. Deploy
  from an EOA (address depends on its nonce) or bind the destination into the salt.

## Escrow factories (v1, v2)

`release`, `refund` and `resolve` write `outcome` after moving the funds. With a
token whose transfer calls the recipient (ERC-777 style hooks) a recipient can
re-enter between the transfer and the write. Reviewed paths:

- `release` / `refund` re-entry finds an empty vault: `_moveAll` reads the live
  balance each time.
- `resolve` makes two transfers from precomputed amounts. A payee hook that calls
  `refund` between them makes the second transfer revert, which reverts the whole
  `resolve`; the payee gains nothing, and after `resolveBy` anyone may refund.

No fund loss for a standard ERC-20. Moving the `outcome` write before the transfers
would be a cleaner checks-effects-interactions order, but it changes the factory
bytecode and therefore every escrow address, so it belongs with the next factory
version, not a patch. The real control is token admission (SEC-18): only tokens
without transfer hooks.

## Slither (0.11.6, `slither.config.json`)

It now parses the project (the parser failure recorded in RFC #143 no longer
reproduces) and reports 24 results across 7 detectors:

| Detector                                 | Verdict                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `timestamp`                              | Intended: escrow windows are time based.                                                          |
| `reentrancy-events`, `reentrancy-benign` | Escrow ordering above; no fund loss for standard tokens.                                          |
| `low-level-calls`                        | `destination.call{value}` in `DepositForwarder`, checked and reverted on failure.                 |
| `incorrect-equality`                     | `balance == 0` early return; not a security check.                                                |
| `too-many-digits`                        | `keccak256(creationCode)` constants.                                                              |
| `locked-ether`                           | False positive: `payEth` forwards `msg.value` into the swap, the interface carries the `payable`. |

Slither exits non-zero while any result remains, so it cannot gate CI as it is. A
gate needs a baseline of these accepted results, and a parser or compiler error
must fail the job rather than print a partial report.

## PaymentRouter: destination registry (SEC-06)

Added after the review above; see [destination-registry.md](./destination-registry.md).
`registerMerchantSafe` (registrar), `revokeMerchantSafe` (guardian or timelock),
`reinstateMerchantSafe` and `setMerchantRegistryEnforced` (timelock). Off at deploy.
Slither: 24 results before and after, none in the new code. The 12 tests in
`test/MerchantRegistry.t.sol` pin the roles, the revoked-cannot-return rule, the
timelocked governance and the fuzzed invariant. Not independently audited.
