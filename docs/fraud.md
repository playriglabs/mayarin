[← Back to the docs index](./README.md)

# Fraud detection (FDS)

A first line of defence at the one moment every payment passes: **confirm**. Rules
are pure, the history behind them is counted from records Mayarin already keeps,
and a payment is blocked only for a reason an operator wrote down.

Packages: `packages/core/fraud` (rules), `packages/core/payment-intent`
(`RiskGate` port, called from `confirm`), `packages/db` (`DrizzleRiskHistory`,
`DrizzleDenylist`, `DrizzleRiskAssessments`), `apps/api` (`RiskGateService`,
routes).

## Verdicts

The vocabulary is the screening one (`packages/core/compliance`):

| Outcome   | Meaning                      | What happens                                             |
| --------- | ---------------------------- | -------------------------------------------------------- |
| `CLEAR`   | no rule fired                | nothing is stored                                        |
| `REVIEW`  | a behavioural rule fired     | the payment goes ahead; it is recorded and announced     |
| `BLOCKED` | the payer is on the denylist | confirm is refused with `403 FORBIDDEN`, no reason given |

A behavioural rule only ever **flags**. Thresholds start unset and are tuned on
real traffic; a rule still being calibrated must not turn away a real buyer. The
payer is told "This payment cannot be processed" and nothing more: naming the rule
teaches how to avoid it. The merchant sees the reason.

## Rules

| Rule                | Fires when                                                                                                                        | Needs a payer address |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `denylist`          | the paying address is on the denylist → **block**                                                                                 | yes                   |
| `payer-velocity`    | intents from one address inside the window reach `payerAttempts`                                                                  | yes                   |
| `merchant-velocity` | intents on one merchant inside the window reach `merchantAttempts`                                                                | no                    |
| `amount-spike`      | the amount is over `spikeFactor` × the merchant's largest paid payment in that currency, and at least `spikeMinHistory` were paid | no                    |

The count includes the payment being confirmed. Deposit-match names no payer
before the money arrives, so on that path only the merchant rules run: the payer
rules apply where a wallet is connected (the contract path, escrow) and on x402.

Thresholds are runtime config, not environment: the market config key `riskRules`,
written with `PUT /v1/admin/market-config/riskRules`. Unset keys are off, and the
default is all off.

```json
{
  "value": {
    "windowSeconds": 3600,
    "payerAttempts": 5,
    "merchantAttempts": 200,
    "spikeFactor": 10,
    "spikeMinHistory": 5
  }
}
```

## Denylist

Operator only: `PUT /v1/admin/denylist/:address` with `{ "reason": "…" }`, and
`DELETE /v1/admin/denylist/:address`. No merchant can edit it. Addresses are
stored lower-cased. A listed address is refused at confirm whatever the rules say.

## What a merchant sees

- Webhook `payment.flagged` (id `<paymentIntentId>:flagged`), for `REVIEW` and
  `BLOCKED`: `{ paymentIntentId, outcome, payer, signals: [{ rule, detail }] }`.
- `GET /v1/risk/flags` (`payments:read`): the flagged payments, newest first,
  `?limit=1..100`. Use it to catch up after downtime.

## Decisions to know

- **It fails open.** If the rules cannot be evaluated (database error) the payment
  goes ahead and the error is logged (`[risk-gate]`). The same outage would already
  be failing the payment; a gate that takes checkout down with it costs more than
  it saves.
- **History is counted, not copied.** Velocity and spike come from `payment_intents`;
  `risk_assessments` holds only the verdicts that were not `CLEAR`, append-only.
- **Blocked here means before the money moves.** Confirm precedes any funds, so a
  block holds nothing. A payer that sends to a deposit address without confirming
  through Mayarin is outside this gate (see Not covered).

## Not covered yet

- Sanctions or exploit-address screening from a vendor. The `ScreeningProvider`
  port is still a seam with no caller; a vendor adapter would feed the same denylist
  or be called from `RiskGateService`.
- A payer address on deposit-match: deposits carry no sender, so it needs the sender
  read from the transaction.
- Dashboard view of flags, and a merchant-set threshold per merchant. Today the
  rules are platform-wide.
