# Conditional Settlement (Escrow)

RFC #304. A payment settles into a per-payment escrow instead of the merchant's
address, and moves on only when a condition holds. Reference: Quant Flow's
programmable-money pilot with UK banks, whose lead use case is escrow-like
logic for marketplace payments.

## Fair to both sides

The rules are fixed in the contract and by validation, not left to the merchant:

| Rule                                                                 | Protects                                                        |
| -------------------------------------------------------------------- | --------------------------------------------------------------- |
| Hold is 1–90 days                                                    | Buyer gets time to inspect; merchant is not locked out for long |
| The payer releases any time; the merchant refunds any time           | Both                                                            |
| A dispute stops the auto-release only if opened before the hold ends | Merchant                                                        |
| The arbiter can never be the payer or the payee                      | Buyer                                                           |
| A dispute still open 7 days after the hold ends refunds the payer    | Buyer — nothing is ever stuck                                   |
| Every term is shown on the checkout page before the buyer connects   | Buyer                                                           |
| The arbiter can only choose payer or payee, never another address    | Both                                                            |

The default arbiter is **Mayarin Resolution** (`ESCROW_ARBITER`): a decision key,
kept apart from the treasury and operator keys, that cannot move funds anywhere
but to one of the two parties. A merchant may name another arbiter, never
their own settlement address.

## Enabling it

- **Merchant default — Settings → Buyer protection.** On, a hold in days, and
  an optional arbiter (`merchants.buyer_protection`). Payment links, invoices
  and the hosted checkout offer it to the buyer, who **opts in by connecting a
  wallet**: that wallet releases or disputes later and receives a refund. A
  buyer paying from an exchange connects nothing, could never release, and is
  paid out as usual. Applies only on escrow chains and never on x402.
- **Per payment — API.** `escrow: { holdSeconds, arbiter? }` makes escrow
  required for that payment (the rail must name the payer's wallet).
  `escrow: null` opts one payment out of the merchant default.

## The rules on chain

| Caller  | `release` (→ payee)                    | `refund` (→ payer)             | `dispute`             |
| ------- | -------------------------------------- | ------------------------------ | --------------------- |
| payer   | any time                               | —                              | before `releaseAfter` |
| payee   | —                                      | any time                       | —                     |
| arbiter | disputed, before `resolveBy`           | disputed, before `resolveBy`   | —                     |
| anyone  | at/after `releaseAfter`, if undisputed | disputed, at/after `resolveBy` | —                     |

`resolveBy = releaseAfter + 7 days`. An arbiter that equals the payer or the
payee is ignored by the contract as well as refused by the planner.

## Contracts

`packages/contracts/payment-router/src/EscrowFactory.sol` and `EscrowVault.sol`.

- **Terms are the salt.** `Terms = (intentId, payer, payee, arbiter,
releaseAfter, resolveBy)`, `salt = keccak256(abi.encode(terms))`, address =
  CREATE2 over `EscrowVault`'s constant init code. Every call passes the terms
  back and the factory recomputes the salt, so nobody can act on an escrow with
  terms other than the ones its address was derived from.
- **Counterfactual.** The router transfers to the address before any code
  exists; the first `release` or `refund` deploys the vault — the
  `DepositForwarder` pattern.
- **No owner, admin, upgrade or pause.** State is `disputed[salt]` (payer only)
  and `outcome[salt]` (`Held | Released | Refunded`, written by a move that
  carried value) so status is one call rather than a log scan.
- **Whole balance.** A move transfers everything the vault holds.
- Deterministic deployer (`scripts/DeployEscrowFactory.s.sol`): one address on
  every chain, `0x545a2C8DD1fc765c61ea5dc2105427Be89c24A45` — deployed on Arbitrum
  Sepolia, Base Sepolia, Ethereum Sepolia and Arc testnet. `ESCROW_CHAINS` in
  `packages/providers/evm/src/escrow.ts` lists where it is deployed.

## No router change

The signed `PaymentRouter` order already names a recipient, `merchantSafe`; an
escrowed order names the escrow address there. Signed orders and deposit
addresses stay valid.

## Backend

- `PaymentIntent.escrow = { holdSeconds, arbiter? }`, validated in
  `createPaymentIntent` / `choosePayment`. `PaymentIntentService` applies the
  merchant's `buyerProtection` when the rail names the payer's wallet, the path
  is not x402, and the chain is an escrow chain.
- The engine passes `escrow + payer` to the planner. Contract path: payer =
  order `refundTo`. Deposit-match: `refundTo` is the treasury, so payer = the
  wallet on the rail. A deposit priced without a signed order is refused rather
  than settled to the merchant.
- `ApiContractPlanner` fills the arbiter (merchant's, else `ESCROW_ARBITER`),
  refuses one equal to payer or payee, fixes `releaseAfter = lock + hold` and
  `resolveBy = releaseAfter + 7d`, and signs the escrow address as
  `merchantSafe`. Terms persist in `clearing_transactions.contract_escrow`.
- `GET /v1/payments/:id/escrow` reads outcome, dispute flag and balance from the
  chain and returns calldata per action. Mayarin submits nothing.

## The keeper

"Anyone" may close a due escrow, but someone has to send the transaction.
`EscrowKeeper` (`apps/api/src/services/escrow-keeper.ts`) runs in the chain
worker every 60 seconds:

- lists escrows whose hold has ended and that are not yet seen closed
  (`clearing_transactions.escrow_outcome is null`);
- reads each one on chain; one already closed by the payer, merchant or arbiter
  is only recorded;
- undisputed → `release` to the merchant; disputed and past `resolveBy` →
  `refund` to the payer; disputed within the window → left for the arbiter;
- sends with the operator key through the treasury executor's nonce lock. The
  operator pays gas and nothing else: the destination is fixed by the terms.

So a 1-day hold pays the merchant within about a minute of the day ending. It
needs the chain worker running with treasury execution enabled.

## Disputes (#313)

The chain decides where the money goes; the dispute record is the case file
beside it, so the arbiter decides on evidence rather than on silence.

- **Opening.** A dispute record (`escrow_disputes`) opens the first time the
  chain shows `disputed` — when anyone reads the escrow view (the checkout
  reloads it right after the dispute transaction), or at the latest when the
  keeper reaches the escrow at `releaseAfter`. It closes when the chain shows
  the funds moved.
- **Evidence.** An append-only thread (`escrow_dispute_messages`), up to 2,000
  characters a message:
  - **Buyer** — on the paid checkout page. Checkout has no session, so each
    message is signed (`personal_sign`, EIP-1271 accepted) by the wallet the
    escrow refunds to. The signed text names the payment and the time; a
    signature older than 10 minutes is refused.
  - **Merchant** — on the payment detail in the dashboard. `/disputes` lists
    the merchant's own disputes, and the sidebar shows how many are open, so
    one is noticed without opening each payment. `/disputes/:id` is the case
    for the merchant: the thread, the reply box and "Refund the buyer" — not
    release or split, which are the arbiter's.
  - **Arbiter** — in the dashboard console.
- **The console.** `/arbitration` in the dashboard lists every open dispute whose
  arbiter is `ESCROW_ARBITER`, across merchants, nearest `resolveBy` first.
  The decision — release to the merchant or refund the buyer — is sent from
  the arbiter's own wallet straight to the factory; the dashboard signs
  nothing. Only accounts holding the platform permission `disputes:arbitrate`
  reach it. No merchant can grant it — not to an account, not to an API key —
  so an operator sets it in the database:

  ```sql
  update users
     set permissions = array_append(permissions, 'disputes:arbitrate')
   where email = 'resolution@mayarin.xyz';
  ```

  The dashboard API needs `ESCROW_ARBITER` set to the same address as the
  payment API; unset, the console is empty.

- **Telling the merchant.** When a dispute's case file is first opened, the
  merchant is told at once: a webhook `escrow.disputed` (one delivery per
  active endpoint, through the same signed, retried queue as payment events;
  the event `id` is the dispute id) and, with `RESEND_API_KEY`, an email to the
  merchant's admin accounts with the dispute number and a link
  (`DASHBOARD_URL`). A failed notice is logged; the dispute stands either way.

  ```json
  {
    "id": "dsp_01K…",
    "type": "escrow.disputed",
    "occurredAt": "2026-10-02T11:21:00.000Z",
    "data": {
      "disputeId": "dsp_01K…",
      "reference": "92965881664",
      "paymentIntentId": "pi_01M…",
      "chain": "base-sepolia",
      "payer": "0x1d96…f48f6",
      "resolveBy": "2026-10-10T11:21:00.000Z"
    }
  }
  ```

- **SLA.** Decide within 3 days of the dispute. The keeper warns at 48 hours
  and 24 hours before `resolveBy` — logged, and posted as `{ "text": … }` to
  `ESCROW_ALERT_WEBHOOK_URL` when set (a Slack or Discord incoming webhook). A
  dispute that reaches `resolveBy` undecided refunds the buyer, and is an
  incident, not a normal outcome.
- **A merchant-named arbiter** decides from its own wallet with the calldata
  in `GET /v1/payments/:id/escrow`; the console lists only Mayarin
  Resolution's disputes.

## Payer standing (#314)

A wallet that keeps disputing — and keeps losing — stops being offered buyer
protection. Its record is counted, not stored: escrowed payments from it, its
disputes, and disputes that ended **released** to the merchant (a claim that
did not hold). A refunded dispute is a claim that held and costs nothing.

A wallet is **flagged** once it has lost `maxLostDisputes` disputes, or — past
`minEscrows` escrowed payments — disputed more than `maxDisputeRateBps` of
them. The rules are runtime config (key `disputeStanding`, default
`{ "maxLostDisputes": 2, "maxDisputeRateBps": 5000, "minEscrows": 4 }`):

```bash
curl -X PUT "$API/v1/admin/market-config/disputeStanding" \
  -H "authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{ "value": { "maxLostDisputes": 3, "maxDisputeRateBps": 4000, "minEscrows": 5 } }'
```

- **Checkout** asks `GET /v1/payers/:address/protection` (`{ eligible }`, never
  the history) when the buyer connects. Optional protection then stays off —
  the buyer can still pay, and the merchant is paid directly. Required
  protection blocks the payment with a reason.
- **The API** enforces the same rule in `PaymentIntentService`: a flagged
  wallet never gets the merchant's default protection, and an escrow the
  merchant requires is refused to it.
- **The merchant** sees "Buyer standing: Good / Flagged" on an escrowed
  payment, not the wallet's history with other merchants.
- **Limit:** a new wallet starts clean, so this stops repeat abuse from one
  address only. The dispute bond (#315) is what makes abuse cost money.

## Factory v2: dispute bond and split (#315)

`EscrowFactoryV2` (`src/EscrowFactoryV2.sol`, vault `EscrowVaultV2.sol`) adds
two rules. v1 stays deployed and immutable; escrows made under it keep v1's
rules, and the backend reads the factory from each stored order, so both
versions run side by side.

- **Dispute bond.** `Terms` gains `bond` (settlement-token units, part of the
  salt). `dispute(terms, token)` pulls it from the payer into the escrow, once
  — the payer approves it to the factory first. `bond == 0` disputes free.
- **Split.** `resolve(terms, token, payeeBps)` — arbiter only, disputed,
  before `resolveBy` — sends `payeeBps / 10000` of the payment to the payee
  and the rest to the payer. Outcome `Split`.

| Move                       | Payment             | Bond                                               |
| -------------------------- | ------------------- | -------------------------------------------------- |
| `release` (anyone allowed) | payee               | payee                                              |
| `refund` (anyone allowed)  | payer               | payer                                              |
| `resolve(payeeBps)`        | split by `payeeBps` | the majority; payer at 50/50                       |
| open at `resolveBy`        | payer               | payer — an absent arbiter is not the payer's fault |

A payer who disputes and then releases has conceded, so the bond goes to the
payee with the payment.

- **Address.** Same deterministic deployer, salt `mayarin.escrow-factory.v2`:
  `0x309bDD9aF097BF0F3FaafF718c5C6c9A7f511B18` on every chain
  (`scripts/DeployEscrowFactoryV2.s.sol`), deployed 2 Oct 2026 on Arbitrum
  Sepolia, Base Sepolia, Ethereum Sepolia and Arc testnet. `ESCROW_V2_CHAINS` in
  `packages/providers/evm/src/escrow.ts` lists where it is deployed; a new
  escrow there is made under v2 (bond zero when the merchant sets none), and
  under v1 elsewhere.
- **Bond size.** Settings → Buyer protection → Dispute bond, 0–20% of what
  reaches the escrow (`buyerProtection.bondBps`, or `escrow.bondBps` per
  payment). The planner fixes it in the terms at the price lock. Checkout
  states it before the buyer connects, and approves it before disputing.
- **The bond is in the settlement token.** A buyer who paid in another asset
  needs that token to dispute.
- **Console.** Release, refund, or split by the merchant's share in percent;
  `GET /v1/payments/:id/escrow/resolve?payeeBps=` returns the call.

## Surfaces

- **Checkout** (link, invoice, cart): states every term, offers "Connect
  wallet"; after payment shows the hold with Release / Dispute, and the dispute thread.
- **Dashboard:** Settings → Buyer protection; payment detail shows the hold, a
  Refund button (direct from the payee, or `Safe.execTransaction` from its
  owner) and the dispute thread; `/disputes` lists the merchant's own disputes;
  `/arbitration` is the arbiter console.
- **SDK:** `payments.createIntent({ escrow })`, `payments.getEscrow(id)`.

## Known limits

- The ledger books the payment as settled when it reaches escrow; a refund is
  not yet posted back.
- The fee is taken before escrow, so a refund returns `minOut − fee`.
- x402 pay-on-delivery is #305.
