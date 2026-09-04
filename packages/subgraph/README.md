# @mayarin/subgraph

A subgraph over `PaymentRouter`, deployed once per network. It is the read side
of the rail choice (#231): given several chains that can settle a payment, which
one has been settling with room to spare.

## What it indexes

| Event              | Entity       | Why                                                                        |
| ------------------ | ------------ | -------------------------------------------------------------------------- |
| `PaymentCompleted` | `Settlement` | The settled payment, plus `headroomSeconds` — `deadline − block.timestamp` |
| `ResidueRefunded`  | `Residue`    | Value returned to the payer that is not part of the settlement split       |
| —                  | `Rail`       | Per-network counters, so liveness is one query rather than a page walk     |

`headroomSeconds` is the number the rail choice is about. A rail that settles
with four seconds left is one network hiccup away from an `ExpiredOrder` revert,
and this repository has already paid for that failure once. Samples are kept
rather than averaged so a caller can take the median over the window it cares
about.

## What it cannot tell you

**Failures.** A reverted payment leaves no log and an authorization that was
never broadcast leaves no transaction, so a failure count has to come from
Mayarin's own records. Nothing here should be presented as one.

**x402 payments.** They never touch `PaymentRouter` — the payer signs an
EIP-3009 authorization and the token moves directly. Indexing them means
indexing the token's `AuthorizationUsed`, which is every EIP-3009 transfer on
that token by anyone, and the authorization's own `validBefore` is not in the
event, so there is no headroom to read. That is a decision to make with the Arc
deployment, not one to guess at here.

## Running it

Deploying needs two things Studio owns: a subgraph created there, and a deploy
key. Create `mayarin-base-sepolia` and `mayarin-arc-testnet` at
[thegraph.com/studio](https://thegraph.com/studio) — the slug must match the name
in the deploy script — then:

```bash
bun install
bunx graph auth <deploy-key>                         # once per machine
bun run --cwd packages/subgraph codegen              # syncs the ABI, then generates types
bun run --cwd packages/subgraph build:base-sepolia   # compile against base-sepolia
bun run --cwd packages/subgraph deploy:base-sepolia  # prompts for a version label
```

`base-sepolia` first: it needs nothing from the Arc deployment, so it de-risks
the whole thing. `deploy:arc-testnet` is the same command against the other
network entry.

The deploy scripts pass `--node https://api.studio.thegraph.com/deploy/`
explicitly. Studio is not the CLI's default node, and without it the failure
names IPFS rather than the node it could not reach.

The ABI is **generated** into `abis/PaymentRouter.json` from `@mayarin/contracts`
before every codegen, so the manifest can never index an event shape the contract
has moved on from. Do not commit or hand-edit it.

## It is AssemblyScript, not TypeScript

The mappings and everything under `generated/` compile with `asc`, not `tsc`.
They look like TypeScript and are not, which shows up in two places:

- **`tsconfig.json` here extends AssemblyScript's own config.** Without it an
  editor typechecks `generated/schema.ts` against the repo's settings and reports
  a dozen errors in a file nobody wrote — `changetype`, `u64` and `i32` are AS
  globals that TypeScript has never heard of. The root `tsconfig.json` excludes
  this package for the same reason.
- **`import type` is banned here** (`useImportType` is off for this package in
  `biome.json`). AssemblyScript has no such syntax: a formatter rewriting a value
  import into a type import turns the mapping into a parse error, and the build
  fails with "the AssemblyScript compiler crashed" rather than anything naming
  the line.

## Adding a network

`subgraph.yaml` carries no per-network truth: `networks.json` does, and
`graph build --network <name>` fills the manifest from it. Adding a chain is an
entry there plus a `deploy:<network>` script — never a second manifest.

`arc-testnet` is present with a zero address on purpose: it is the slot the Arc
deployment fills in, and a zero address fails loudly at build rather than
indexing nothing quietly.
