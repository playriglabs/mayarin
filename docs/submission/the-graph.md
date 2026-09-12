# ETHOnline 2026 — The Graph

**Project:** Mayarin — a programmable clearing layer for humans, applications and
autonomous agents. **Pool:** Continuity. **Repository:**
<https://github.com/playriglabs/mayarin>

## What the agent buys

`POST /x402/mcp` is an MCP server sold per call over x402. An agent connects with
no account and no API key, reads what the tools do for free, calls one, receives a
`402`, signs one authorization, and gets its answer. What it is buying is the one
thing Mayarin knows and the agent cannot look up: **how each payment rail has
actually been settling**, read from Mayarin's own settlements subgraph on Subgraph
Studio.

The agent pays ten cents to find out which rail to pay on.

## Two Graph products, composed

1. **A subgraph on Subgraph Studio** — `packages/subgraph`, deployed as `v0.0.2`
   to two networks, indexing `PaymentCompleted`, `ResidueRefunded` and a
   `headroomSeconds` observation per settlement.

   | Network        | Query URL                                                                   |
   | -------------- | --------------------------------------------------------------------------- |
   | `base-sepolia` | `https://api.studio.thegraph.com/query/1758657/mayarin-base-sepolia/v0.0.2` |
   | `arc-testnet`  | `https://api.studio.thegraph.com/query/1758657/mayarin-arc-testnet/v0.0.2`  |

2. **An MCP server over that subgraph** — `POST /x402/mcp`, JSON-RPC, two tools
   that do work on the data rather than returning a query result:
   - `rail_stats` — per rail: samples, median headroom, and the worst and best
     observed. _Headroom_ is the seconds an order had left before its deadline
     when it landed, so the minimum is what matters: Base Sepolia's median is 828
     seconds and its worst settlement landed with 28.
   - `choose_rail` — ranks the rails and returns the one to pay on with the reason
     in one line.

The subgraph is also read by the settlement indexer itself through a
`SettlementSource` port, so it is inside the payment path rather than beside it.

## Measured on chain

A Circle Agent Stack wallet bought one `choose_rail` call on Base Sepolia,
7 September 2026, with no account and no API key:

|          |                                                                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payment  | [`0xdce241e2…`](https://sepolia.basescan.org/tx/0xdce241e203e3de3fd1fcd2e2e421d5a7d97a5ff8174a3df2314a4bf73baf6c8b) — 100000 USDC, payer's gas **zero** |
| Answer   | `arc-testnet: median headroom 936.5s over 12 settlements`, off live Studio data                                                                         |
| Ledger   | Intent `pi_01M1WYBY4FM766VPSAWY128JHA` `COMPLETED`, clearing `clr_01M1WYBY5R4V0Z4B3FJVTR1V1K` `SUCCESS`, fee zero, postings balanced                    |
| Evidence | [`docs/evidence/base-sepolia-mcp-231.json`](../evidence/base-sepolia-mcp-231.json)                                                                      |

## Load-bearing, and checkable by deletion

Remove the subgraph and the rail choice does not quietly become a worse guess — it
announces itself. `choose_rail` reports an unobserved rail rather than presenting
the first offered one as a decision, and with no settlements observed at all the
call is **refused free rather than sold**, because charging an agent for "no rail
has been observed" is charging it for our own outage. The settlement indexer, for
its part, reads the chain directly again the moment a chain is no longer named in
`SUBGRAPH_ENDPOINTS`.

Three design decisions are worth reading literally, because each one is a refusal:

- **Discovery is free, answers are paid.** An agent cannot decide a price is worth
  paying for a tool whose description it has not been allowed to read; a `402` on
  the catalogue is a shop with the lights off.
- **Neither tool queries The Graph directly.** Both read the cached observer the
  `402` itself reads, because Subgraph Studio allows 3,000 queries a day
  _account-wide_ — a pay-per-query tool wired straight through hands anyone who
  can pay a way to spend the whole deployment's budget.
- **x402 settlements are deliberately not indexed.** They never touch
  `PaymentRouter`, and the token's `AuthorizationUsed` carries no `validBefore`,
  so there is no headroom to read off them. Indexing them would add sample counts
  that measure nothing the selector ranks on. The agent is told the basis rather
  than left to assume it: both tools state their sample counts.

`chooseRail` ranks on the **median**, so one lucky settlement cannot carry a rail,
and failures are reported but never ranked on — that number cannot come from the
chain, and `undefined` would quietly become zero.

## Pre-existing, and built in the window

**Pre-existing — merged before the window opened on 4 September 2026.** The
clearing engine, double-entry ledger, deposit matching, `PaymentRouter`, quoting
and liquidity routing, the commerce surfaces, the dashboard, the SDK and the
documentation set (Phases 1–3). The x402 protocol spine (#220–#230: facilitator
port, resource registry, replay key, HTTP surface) merged on 3 September, the day
before the window opened, and is listed here rather than claimed for the event.

**Built during the window, 4–13 September 2026** — all of it under
[#231](https://github.com/playriglabs/mayarin/issues/231):

| What                                                                         | Where                            |
| ---------------------------------------------------------------------------- | -------------------------------- |
| The settlements subgraph, schema and handlers                                | `packages/subgraph/`             |
| `SubgraphRailObservations` and `SubgraphSettlementSource` behind their ports | `packages/providers/subgraph/`   |
| `chooseRail` and the rail summary — pure, 11 tests, one per rule             | `packages/core/x402/src/rail.ts` |
| The MCP wire format, no domain in it                                         | `apps/api/src/mcp/protocol.ts`   |
| The two tools, and what they refuse to sell                                  | `apps/api/src/mcp/rail-tools.ts` |
| The free/paid line and the gate ordering                                     | `apps/api/src/routes/mcp.ts`     |
| The indexer reading the subgraph instead of `eth_getLogs`                    | `packages/core/chain/`           |

## Try it

Free, and needs no wallet:

```bash
curl -X POST $API/x402/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Paid — the **same body** must be sent in the request that receives the `402` and in
the retry carrying the signature, because a different one would be a different
purchase settled against the first one's authorization:

```bash
bun run scripts/e2e-x402.ts --url $API/x402/mcp --pay-to 0x… \
  --body '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"choose_rail","arguments":{"chains":["base-sepolia","arc-testnet"]}}}'
```
