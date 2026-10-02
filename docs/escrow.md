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
  every chain, `0x545a2C8DD1fc765c61ea5dc2105427Be89c24A45`. `ESCROW_CHAINS` in
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

## Surfaces

- **Checkout** (link, invoice, cart): states every term, offers "Connect
  wallet"; after payment shows the hold with Release / Dispute.
- **Dashboard:** Settings → Buyer protection; payment detail shows the hold and
  a Refund button (direct from the payee, or `Safe.execTransaction` from its
  owner).
- **SDK:** `payments.createIntent({ escrow })`, `payments.getEscrow(id)`.

## Known limits

- The ledger books the payment as settled when it reaches escrow; a refund is
  not yet posted back.
- The fee is taken before escrow, so a refund returns `minOut − fee`.
- x402 pay-on-delivery is #305.
