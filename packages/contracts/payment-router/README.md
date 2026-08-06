# @mayarin/contracts-payment-router

`PaymentRouter.sol` — the Phase 3 on-chain execution layer
([RFC #4](https://github.com/playriglabs/mayarin/issues/4)): a stateless
contract that receives the payer's asset, swaps through a whitelisted DEX
router when the assets differ, and settles `minOut − fee` to the merchant Safe
in one atomic transaction. Hard revert on `minOut` miss; zero resting balance;
`intentId` consumed on success.

This package is currently the **scaffold only** (#23). The order domain,
pay paths, admin surface, and invariant suite land in #24–#29.

## Commands

```bash
forge build          # compile
forge test           # unit + (later) fuzz/invariant tests
forge soldeer install  # fetch dependencies/ after a fresh clone
```

From the repo root: `bun run test:contracts`.

Foundry is required (not managed by bun):
`curl -L https://foundry.paradigm.xyz | bash && foundryup`.

## Policies

- **Solidity** is pinned in `foundry.toml` (`solc = 0.8.28`, `evm_version =
cancun` — supported on Base, the primary chain). Bump deliberately, in its
  own commit.
- **License**: MIT per-file SPDX headers. The contract source is publicly
  verified on-chain at deploy time (#29), so headers are mandatory.
- **Dependencies** come through soldeer (`[dependencies]` in `foundry.toml`,
  vendored into `dependencies/`, locked by `soldeer.lock`) — no git
  submodules in the monorepo. OpenZeppelin arrives with #24, Permit2 with
  #26, through the same mechanism. `dependencies/` is gitignored;
  `soldeer.lock` is committed.
- **Remappings** are declared explicitly in `foundry.toml`
  (`remappings_generate = false`) so the build is deterministic.

## CI story

Not wired yet (lands with #28, alongside the gas snapshot): a CI job installs
Foundry via `foundry-rs/foundry-toolchain`, runs `forge soldeer install`, then
`forge test` and `forge snapshot --check`. Solidity is intentionally outside
`bun run check` — the TS pipeline stays Foundry-free, and the pre-push hook is
unchanged.
