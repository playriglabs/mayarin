# Conditional Settlement (Escrow)

RFC #304. A payment settles into a per-payment escrow instead of the merchant's
address, and moves on only when a condition holds. Reference: Quant Flow's
programmable-money pilot with UK banks, whose lead use case is escrow-like
logic for marketplace payments.

## The rules

| Caller  | `release` (→ payee)                    | `refund` (→ payer) | `dispute`             |
| ------- | -------------------------------------- | ------------------ | --------------------- |
| payer   | any time                               | —                  | before `releaseAfter` |
| payee   | —                                      | any time           | —                     |
| arbiter | only when disputed                     | only when disputed | —                     |
| anyone  | at/after `releaseAfter`, if undisputed | —                  | —                     |

A dispute stops the timeout release. With no arbiter (`address(0)`), a disputed
escrow moves only by payer release or payee refund.

## Contracts

`packages/contracts/payment-router/src/EscrowFactory.sol` and `EscrowVault.sol`.

- **Terms are the salt.** `Terms = (intentId, payer, payee, arbiter, releaseAfter)`,
  `salt = keccak256(abi.encode(terms))`, address = CREATE2 over `EscrowVault`'s
  constant init code. Every call passes the terms back; the factory recomputes
  the salt, so a caller cannot act on an escrow with terms other than the ones
  its address was derived from.
- **Counterfactual.** The router transfers to the address before any code
  exists. The vault is deployed by the first `release` or `refund` — the same
  pattern as `DepositForwarder`.
- **No owner, admin, upgrade or pause.** State is two mappings: `disputed[salt]`
  (set only by the payer) and `outcome[salt]` (`Held | Released | Refunded`,
  written only by a move that carried value), kept so the backend reads status
  in one call instead of scanning logs — free-tier RPCs cap `eth_getLogs` at a
  few blocks.
- **Whole balance.** A move transfers everything the vault holds, so once one
  has run there is nothing left for the other.
- Deployed through the canonical deterministic deployer
  (`scripts/DeployEscrowFactory.s.sol`): one address on every chain,
  `0xd56E903c8E31953a0cD1c2f691f55A0e2b41A95F`. `ESCROW_CHAINS` in
  `packages/providers/evm/src/escrow.ts` lists where it is deployed; an escrowed
  payment elsewhere is refused before an order is signed.

## No router change

The signed `PaymentRouter` order already names a recipient, `merchantSafe`. An
escrowed order names the escrow address there. Nothing in the router, the
EIP-712 type or the deposit forwarders changed, so every signed order and
deposit address stays valid.

## Backend

- `PaymentIntent.escrow = { holdSeconds, arbiter? }`, validated in
  `createPaymentIntent` / `choosePayment`: hold ≤ 90 days, the rail must carry
  `payerAddress`, and x402 is refused (its payer is known only after signing).
- The engine passes `escrow + payer` into the planner. On the contract path the
  payer is the order's `refundTo`; on deposit-match `refundTo` is the treasury,
  so the payer is the wallet named on the rail. A deposit priced without a
  signed order (no treasury executor) is refused rather than settled to the
  merchant.
- `ApiContractPlanner` fixes `releaseAfter = lock time + holdSeconds`, derives
  the address, and signs it as `merchantSafe`. The terms persist on the order
  (`clearing_transactions.contract_escrow`); `renew` copies them unchanged.
- `GET /v1/payments/:id/escrow` reads `outcome`, `disputed` and the vault's
  balance from the chain and returns calldata for each action. Mayarin submits
  nothing: payer, merchant or arbiter send from their own wallets.

## Surfaces

- **Hosted checkout:** an escrowed intent offers only escrow chains, asks the
  payer to connect the wallet they will release from (they may still fund from
  any wallet), and after payment shows the hold with Release / Dispute.
- **Dashboard:** the payment detail shows the hold and a Refund button. The
  dashboard API builds the call: direct when the connected wallet is the payee,
  otherwise wrapped in `Safe.execTransaction` from the owner, as payouts do.
- **SDK:** `payments.createIntent({ escrow })`, `payments.getEscrow(id)`.

## Known limits

- The ledger books the payment as settled when it reaches escrow; a refund is
  not yet posted back. Reconciliation sees the escrow address as `merchantSafe`.
- The fee is taken before escrow, so a refund returns `minOut − fee`.
- x402 pay-on-delivery is #305.
