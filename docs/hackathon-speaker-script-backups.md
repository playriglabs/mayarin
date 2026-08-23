[← Slides 5–7](./hackathon-speaker-script-slides-5-7.md) ·
[Pitch deck source →](./pitch-deck.md)

# Hackathon Speaker Script — Backup Slides A–C

These slides are for Q&A only. Never present them as an eighth, ninth, or tenth
core slide. First answer the judge in one sentence, then open the relevant
backup slide only if the visual will make the answer clearer.

## Backup A — System architecture

**Use when asked:** “How does it work?”, “Why are there two transactions?”, or
“Where does the clearing happen?”

**Recommended speaker:** Citra

`[Open Backup A. Point from left to right once.]`

> A merchant intent and the customer's asset choice enter one Mayarin
> orchestration layer. The quote engine locks the settlement terms, then we can
> execute through one of two live paths.
>
> The primary path calls PaymentRouter for an atomic swap and settlement. The
> fallback path accepts a plain wallet transfer, watches and matches the
> per-payment address, then the executor routes it through PaymentRouter.
>
> Both paths converge on the same idempotent clearing engine, balanced ledger,
> reconciliation, and stablecoin settlement to the merchant.

**If asked why two paths:**

> The contract path gives the strongest atomic guarantee. The deposit path adds
> compatibility for wallets or exchanges that can only make a plain transfer.

**Do not say:** both paths are one transaction, both are non-custodial
throughout, or every asset and chain is already supported.

## Backup B — Risks we carry

**Use when asked:** “What can go wrong?”, “Where is custody?”, “What about a
stablecoin depeg?”, or “Are you mainnet ready?”

**Recommended speaker:** Citra

`[Open Backup B. Start with the left column, then acknowledge the right.]`

> We separate what the system guarantees from the risks it cannot remove.
>
> We guarantee an exact amount of the settlement stablecoin—not that the
> stablecoin will always preserve its fiat value. On the demonstrated deposit
> path, the executor also holds the payer asset briefly while sweeping; the
> primary contract path avoids that custody window.
>
> Signing infrastructure, oracles, DEX liquidity, RPC providers, and stablecoin
> issuers remain dependencies. We bound those dependencies with signed limits,
> allowlisted merchant wallets, timelocked controls, and reconciliation.
>
> The deposit forwarder passed static analysis, but not yet an adversarial
> review. That is why our next step is a controlled pilot and defined mainnet
> hardening—not an unrestricted launch.

**If asked whether Mayarin is custodial:**

> The answer depends on the execution path. The primary contract path is atomic
> with no resting contract balance. The fallback deposit path has brief operator
> custody, and we disclose that boundary directly.

**If asked about depeg:**

> The hard lock protects the number of settlement tokens delivered. It cannot
> guarantee their fiat value after a depeg, so issuer and redemption risk remain.

**Do not say:** risk-free, fully audited, mainnet ready, or non-custodial across
both paths.

## Backup C — Claim ledger

**Use when asked:** “What is actually live?”, “What is still roadmap?”, “Where
is the proof?”, or “Are the contracts deployed?”

**Recommended speaker:** Rizky for product status; Citra for contract details.

`[Open Backup C. Do not read the table row by row.]`

> We use this ledger to keep every pitch claim honest. Each capability is
> labelled Live, Provider-backed, Next, Later, or Accepted risk, with its source
> beside it.
>
> Live today on Base Sepolia are both execution paths, atomic contract
> settlement, exact money handling, balanced ledger and reconciliation,
> merchant wallet controls, dashboard, SDK, webhooks, WooCommerce, and embedded
> checkout.
>
> Mainnet hardening, gas-free withdrawal, broader assets and chains, and the
> fiat off-ramp are explicitly not presented as live.

**If asked for contract proof:**

> PaymentRouter, TimelockController, and DepositForwarderFactory are deployed
> and verified on Base Sepolia. Their addresses are listed here so the claim is
> independently checkable.

**If asked about passkeys:**

> The wallet provider's authorization model is provider-backed. The complete
> passkey browser ceremony in our dashboard remains a next step.

**If asked about Agent Pay:**

> It remains later. We will not let an autonomous agent move funds before we
> have scoped identity, limits, approvals, revocation, idempotency, and a full
> audit trail.

**Do not say:** everything in the ledger is live. The point of this slide is to
show the boundary between proof, dependency, roadmap, and accepted risk.

## Q&A control

- Lead with the direct answer, not “let me show you a slide.”
- Keep the first answer under 30 seconds. Let the judge request more depth.
- After answering, stay on the relevant backup slide only if the next question
  uses it; otherwise return to slide 7.
- If uncertain, state the boundary: “That is not live today; it is in our next
  phase.” Never improvise a capability or compliance claim.
