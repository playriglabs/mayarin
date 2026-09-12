# ETHOnline 2026 — Arc (Circle)

**Project:** Mayarin — a programmable clearing layer for humans, applications and
autonomous agents. **Pool:** Continuity. **Repository:**
<https://github.com/playriglabs/mayarin>

## What Arc is used for

Arc is the settlement rail. A merchant prices in their own currency — IDR 50,000
for a bag of coffee — and is paid an exact USDC amount on Arc; the payer brings
whatever asset they hold, and never sees the merchant's currency. Arc's native
currency being USDC is the point: the asset the merchant settles in and the asset
the chain runs on are the same one, so a merchant is never asked to hold a
separate gas token to be paid.

Three things were built on it during the window: the full clearing rail deployed
to Arc testnet, a merchant Safe that has **one address on every chain**, and
Circle Agent Stack contract-account wallets as a payer class — an agent that
signs once and whose signature the token accepts through EIP-1271.

## Deployed on Arc testnet (chain `5042002`)

| Contract                  | Address                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| `PaymentRouter`           | [`0xee7c5b5a…`](https://testnet.arcscan.app/address/0xee7c5b5a9eeaf667a6efb217a8a77534c873f7a9) |
| `DepositForwarderFactory` | [`0x04cd74e7…`](https://testnet.arcscan.app/address/0x04cd74e77ac145b18d61c6c8d7939e3241dbb60a) |

USDC `0x3600…0000`, EURC `0x89B5…D72a`. A `TimelockController` owns the router.
Settlements are indexed by a subgraph on Subgraph Studio.

## Measured on chain

Three runs, each with a committed evidence file rather than a screenshot.

**Contract path, 6 September.** Transaction
[`0x461ba2fe…`](https://testnet.arcscan.app/tx/0x461ba2fe1276832cae781d804f2cf7184ae5d246a22052fc55590e01700a758d),
intent `pi_01M1TNQT88FRYY5CV5EWAYQZCX` `COMPLETED`, clearing
`clr_01M1TNQT8QTZE3C7XT6CK2AJZA` `SUCCESS`, indexer recorded 1 / confirmed 1 /
completed 1 / unmatched 0, and three balanced ledger stages.
[`docs/evidence/arc-contract-208.json`](../evidence/arc-contract-208.json)

**x402, paid by a Circle agent wallet, 6 September.** Transaction
[`0xe1d37298…`](https://testnet.arcscan.app/tx/0xe1d3729806ea2621f723388550ea88d0b0a07beb518b287f3fdc82fed287fa08),
payer `0x5742…9648` (custody `circle-agent-wallet`), 20000 USDC, intent
`pi_01M1V97XNGWB8BPJB5GHPEY3EW` `COMPLETED`. **The payer's gas was zero** — the
operator broadcasts what the wallet signed.
[`docs/evidence/arc-x402-circle-208.json`](../evidence/arc-x402-circle-208.json)

**Cross-asset, same wallet, 6 September.** The agent signs 2.046810 EURC and the
merchant is paid exactly 1.000000 USDC:
[`0xf08c141d…`](https://testnet.arcscan.app/tx/0xf08c141d2c11de1ac9abc3ca1b4da201bce901250148bd4436b86b421638beba)
and swap
[`0x9f4bf25b…`](https://testnet.arcscan.app/tx/0x9f4bf25b74fe3cb18087ff4e93eff22b530b48f2e7a41fbd064280f3abfc1e52).
See [`uniswap.md`](./uniswap.md) for the execution half.
[`docs/evidence/arc-x402-circle-cross-asset-208.json`](../evidence/arc-x402-circle-cross-asset-208.json)

## The thing Arc made us get right

**Arc's native currency is USDC, with 18 decimals in the native view and 6 in the
ERC-20 view over one balance.** Declaring it native would give one holding two
`AssetCode`s and count the same money twice, so `CHAIN_NATIVE_ASSETS` is
deliberately left without an Arc entry — the rejection happens before any RPC call.
Balances are read through `balanceOf`, a regression test round-trips
`1.234567 USDC`, and the native mirror log is kept out of x402 confirmation. The
whole audit is [`docs/arc.md`](../arc.md), and Arc balances have been trusted on
that basis since the 6 September paid runs.

Two more things the deployment forced:

- **`AssetCapabilities` is probed from the chain at boot**, not read from a
  resource row, so the `402` states the token's real EIP-712 domain and transfer
  method.
- **The operator key had to reach the API process.** x402 broadcasts the payer's
  authorization from the API, and the key had been scoped to the chain-worker on
  purpose — one signer for the chain. Excluding it produced a deployment where
  `/x402/*` answered 404 and looked healthy.

## Pre-existing, and built in the window

**Pre-existing — merged before the window opened on 4 September 2026.** The
clearing engine and its nine-state machine, the double-entry ledger, deposit
matching, `PaymentRouter` and the forwarder factory, quoting and liquidity
routing, the commerce surfaces, the merchant dashboard, the SDK and the
documentation set (Phases 1–3). The x402 protocol spine (#220–#230) merged on
3 September, the day before the window opened, and is listed here rather than
claimed for the event.

**Built during the window, 4–13 September 2026** — mostly under
[#208](https://github.com/playriglabs/mayarin/issues/208):

- Arc testnet deployment and configuration, verified on ArcScan.
- The native-decimal audit and its regression tests — [`docs/arc.md`](../arc.md).
- `EvmAssetCapabilityProbe` called from the composition root at boot.
- Circle Agent Stack as a payer class: contract-account wallets whose EIP-1271
  signatures the token accepts, and the payer-address handling that lets one pay
  at all (#270).
- **One managed Safe address on every EVM chain**: later chains reuse the first
  chain's signers and salt, and the canonical Safe 1.4.1 contracts are matched by
  bytecode hash per chain before anything is derived — no per-chain table, so
  adding a network is configuration only.
- One link, many rails (#244, closed with #258 and #261): the payer picks chain
  and asset at checkout, filtered per chain, and a rail is offered only where the
  merchant can actually be paid.
- Per-chain balances in the dashboard — one row per chain the deployment settles
  on, including chains where the merchant has no address yet, because an absent
  row and an empty row read the same to a merchant and only one of them says
  there is something to do.

## Stated plainly: what is not done

- **Circle wallet policies are not used.** `circle wallet limit set` needs a
  mainnet chain and Circle lists Arc on testnet only, so the policy half was
  abandoned rather than left pending. The spend ceiling in the demo is enforced by
  the agent runner, and it is honest about which side it sits on.
- **Testnet only.** Mainnet is deliberately unprovisioned until the documented
  security and deployment gates are met, and must not reuse testnet state,
  contracts or credentials.
