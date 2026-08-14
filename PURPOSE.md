# Proposed Whitepaper Title

Mayarin: Programmable Clearing Infrastructure for Stablecoin Commerce

Subtitle:

> Price in fiat. Settle in stablecoins. Pay with any supported asset.

# 1. Abstract

Explain Mayarin in one page:

- Merchants price products in local fiat currency.
- Customers pay with supported crypto assets.
- Mayarin quotes, routes, converts, settles, and records the payment.
- Merchants receive a chosen stablecoin.
- The backend orchestrates; smart contracts execute value movement.
- The merchant does not need to manage blockchain infrastructure.

Clearly state that Mayarin is payment infrastructure, not an exchange, bank, custodial wallet, or fiat gateway.

Source: ./docs/vision.md

# 2. The Problem

Describe the current friction from each participant’s perspective.

## Merchant friction

- Merchants think in IDR, USD, SGD, or another local currency.
- Crypto payments expose merchants to volatile payer assets.
- Merchants must manage wallets, private keys, seed phrases, and gas.
- They must understand DEXs, exchange rates, slippage, and chains.
- They need to reconcile which customer paid, which asset arrived, and what was settled.
- Existing systems often force merchants to accept one specific token.
- Stablecoin balances may exist, but merchants still need a safe withdrawal path.

## Customer friction

- Customers may hold ETH, USDC, USDT, or another asset.
- They may not own the exact stablecoin requested by a merchant.
- They may use a wallet, exchange withdrawal, QR scan, or plain address transfer.
- Wallet interfaces are not designed around merchant invoices.
- Manual crypto amounts can be too precise for ordinary users.
- Failed, underpaid, or expired transactions are difficult to understand.

## Developer friction

- Payment APIs, wallets, DEXs, chains, and webhooks are fragmented.
- Developers repeatedly rebuild payment state machines.
- Different integrations have different settlement and accounting behavior.
- Most payment platforms couple business logic to one provider.

## Infrastructure friction

- Blockchain transactions can be delayed or reorganized.
- Webhooks can be duplicated, replayed, or arrive out of order.
- A backend may accidentally become a custodian.
- Ledger balances can diverge from on-chain reality.
- Deposit transfers may not contain an invoice reference.

# 3. The Core Thesis

State the central idea:

> Crypto payment adoption does not require merchants to become crypto infrastructure operators.

Mayarin separates:

- Merchant pricing
- Customer payment asset
- Liquidity and conversion
- On-chain execution
- Settlement
- Accounting
- Wallet ownership

The merchant experiences one payment API while Mayarin coordinates the underlying systems.

# 4. Design Goals and Non-Goals

## Goals

- Fiat-denominated merchant pricing.
- Stablecoin settlement.
- Any supported payer asset.
- Trust-minimized on-chain execution.
- Provider-agnostic integrations.
- Exact and auditable accounting.
- Resumable and idempotent payments.
- Merchant-controlled wallets.

## Non-goals

Mayarin is not:

- A cryptocurrency exchange.
- A custodial wallet.
- A bank or fiat payment rail.
- A stablecoin-to-fiat off-ramp in the MVP.
- A treasury FX desk.
- A system that absorbs unlimited slippage or depeg risk.

Source: ./docs/vision.md, ./docs/settlement.md

# 5. System Overview

Introduce the complete architecture:

Merchant / Developer
│
▼
API and SDK
│
▼
Payment Intent
│
├── Quote Engine
├── Liquidity Router
├── Execution Planner
├── PaymentRouter Smart Contract
├── Chain Indexer / Watcher
├── Double-Entry Ledger
└── Merchant Wallet

Explain that the same payment intent remains the central object regardless of:

- Payer asset
- Blockchain
- Execution path
- Settlement provider
- Merchant wallet provider

Source: ./docs/architecture.md

# 6. Payment Intent Model

Explain the payment intent as an immutable commercial request.

Include:

- Merchant identity.
- Merchant price and source currency.
- Settlement asset.
- Payer asset and chain.
- Expiration.
- Execution path.
- Payment lifecycle.
- Idempotency key.
- Versioning and optimistic concurrency.

Show the lifecycle:

CREATED
→ CONFIRMED
→ PROCESSING
→ COMPLETED

or

FAILED / EXPIRED

Then explain the deeper clearing lifecycle:

CREATED
→ QR_PARSED
→ PRICE_LOCKED
→ PAYMENT_PENDING
→ ASSET_RECEIVED
→ CLEARING
→ SETTLING
→ SETTLED
→ SUCCESS

Source: ./docs/payment-intent.md, ./docs/clearing-engine.md

# 7. End-to-End Payment Flow

Use one concrete example:

Merchant price: IDR 50,000
Customer pays: ETH
Merchant receives: USDC

Describe:

1. Merchant creates a payment intent.
2. Mayarin validates the settlement and payer assets.
3. Fiat-to-settlement quote is calculated.
4. A quote is locked with TTL and slippage protection.
5. The customer receives a payment request.
6. The customer pays through a wallet or deposit transfer.
7. Mayarin detects or indexes the transaction.
8. The smart contract swaps the asset if necessary.
9. The merchant receives the settlement asset.
10. The indexer records the confirmed result.
11. The ledger and dashboard are updated.
12. Webhooks notify merchant systems.

# 8. Two Execution Paths

This deserves its own section because it is one of Mayarin’s strongest design decisions.

## Contract path

For customers who connect a wallet:

Customer wallet
→ PaymentRouter
→ atomic swap
→ merchant Safe
→ PaymentCompleted event
→ indexer
→ ledger

Properties:

- Atomic receive, swap, and settlement.
- Hard revert if minOut is not achieved.
- No resting balance in the contract.
- On-chain idempotency through intentId.
- Merchant payment happens directly to the merchant wallet.

## Deposit-matching path

For exchange withdrawals, QR scans, and plain transfers:

Payment intent
→ per-intent deposit address
→ wallet watcher
→ confirmation policy
→ treasury executor
→ PaymentRouter
→ merchant wallet

Explain why both paths are necessary:

- A connected wallet can submit contract calldata.
- An exchange withdrawal can only send a normal transfer.
- A QR scanner cannot construct a backend-signed contract call.
- A per-intent address makes a plain transfer identifiable.

Source: ./docs/chain.md, ./docs/architecture.md

# 9. Quote and Liquidity Architecture

Explain the difference between:

- Merchant settlement amount.
- Customer payer amount.
- Display estimate.
- Executable minOut.
- Price oracle reference.
- DEX or aggregator route.

Important principles:

- The DEX quote determines executable output.
- The oracle protects against abnormal deviation.
- The oracle is not treated as the fill price.
- Same-asset payments skip conversion.
- Quotes use integer math.
- Quote expiration never silently re-quotes.
- A new price requires new payer consent.

Include the role of:

- Liquidity Router.
- Price Source.
- Uniswap.
- 0x.
- LiFi.
- Pyth.
- Chainlink.

Source: ./docs/liquidity-routing.md, ./docs/quote-signing.md

# 10. Smart Contract Execution and Security

Explain PaymentRouter as the execution keystone.

Cover:

- EIP-712 signed orders.
- intentId replay protection.
- minOut.
- Fee calculation.
- Merchant destination.
- Refund destination.
- Deadline.
- Approved assets.
- Approved DEX routers.
- Timelocked administration.
- Emergency pause.
- Zero resting contract balance.

Clarify the backend’s role:

- It creates intents.
- It creates quotes.
- It selects routes.
- It signs an order through a protected signing key.
- It does not directly move customer funds.

The whitepaper should explain that atomic execution avoids requiring Mayarin to operate a capitalized FX treasury.

# 11. Wallet and Custody Model

This should be a major trust section.

Explain the three wallet paths:

1. Existing merchant wallet.
2. Passkey-created merchant wallet.
3. Managed Safe wallet.

State the custody guarantees:

- Mayarin is never the sole merchant signer.
- A merchant-controlled key exists from wallet creation.
- The merchant can remove Mayarin and leave.
- Turnkey is a policy provider, not the merchant’s owner.
- The quote-signing key cannot directly withdraw merchant funds.
- Merchant payout addresses are verified.
- Treasury and merchant wallets are separated.

Explain that the system is “provisioned, not custodial.”

Source: ./docs/wallet.md, ./docs/architecture.md

# 12. Chain Observation and Finality

Explain the chain layer:

- Watch-only xpub for deposit address derivation.
- Per-intent address allocation.
- ERC-20 log scanning.
- Native transfer scanning.
- Block cursors.
- Confirmation depth.
- Reorg detection.
- Reconciliation after downtime.
- Orphaned deposit handling.
- Settlement event indexing.

Important principle:

> A transaction is not treated as final merely because it was observed.

Explain that deposits become usable only after configured confirmation depth.

Source: ./docs/chain.md

# 13. Accounting and Ledger Integrity

Explain why Mayarin uses a double-entry ledger.

Include:

- Append-only postings.
- No direct balance mutation.
- Per-asset balancing.
- Treasury.
- Merchant payable.
- Settlement in flight.
- Merchant holdings.
- Fees.
- Payer asset held.
- Payer asset obligation.
- FX result.
- Gas expense.

Show the basic posting:

ASSET_RECEIVED
Debit Treasury
Credit Merchant Payable
Credit Fee Revenue

CLEARING
Debit Merchant Payable
Credit Settlement In Flight

SETTLED
Debit Settlement In Flight
Credit Treasury or Merchant Holding

Explain the difference between:

- Ledger truth for internal balances.
- Chain truth for on-chain settlement.
- Derived ledger projections.
- Reconciliation when the two disagree.

Source: ./docs/ledger.md

# 14. Exact Money and Payment Precision

Explain why financial correctness requires more than ordinary decimal formatting.

Include:

- BigInt minor units.
- Asset-specific decimals.
- No floating-point balances.
- Machine-form versus human-form amounts.
- Locale-aware formatting.
- Payer precision.
- Round-up behavior to avoid underpayment.
- Exact QR and API amounts.

This section is valuable because it demonstrates that Mayarin addresses practical payment failures, not only blockchain settlement.

Source: ./docs/money.md

# 15. Stablecoin Registry

Explain that stablecoins are not just symbols.

The registry contains:

- Asset code.
- Decimal precision.
- Chain.
- Contract address.
- Whether the asset is on-chain.
- Whether it is admissible for settlement.
- Whether it can be used as a payer asset.

Explain the distinction between:

- Ledger-only stablecoins.
- On-chain stablecoins.
- Settlement assets.
- Deposit assets.

Source: ./docs/stablecoin.md

# 16. Merchant and Developer Experience

Describe the product surfaces:

- REST API.
- TypeScript SDK.
- Hosted checkout.
- Embeddable checkout.
- Payment links.
- Static merchant QR.
- Dashboard.
- Webhooks.
- WooCommerce plugin.
- Product catalog.
- Orders.
- Customer records.
- Settlement and wallet views.
- Event logs.
- Analytics.

Emphasize the architectural boundary:

> The commerce layer creates payment intents; it does not replace the payment engine.

This allows developers to build:

- E-commerce stores.
- POS applications.
- Marketplaces.
- Invoices.
- Embedded checkout.
- Agent-driven commerce.

Sources: ./docs/api.md, ./docs/embed.md, ./docs/woocommerce.md

# 17. Reliability and Failure Handling

This section should explain why Mayarin can operate payment infrastructure safely.

Cover:

- Idempotency.
- Resumable transactions.
- Persisted state.
- Retry-safe effects.
- Webhook replay handling.
- Out-of-order delivery.
- Confirmation depth.
- Reorg handling.
- Expired quote handling.
- Failed swap behavior.
- Underpayment and overpayment.
- Crash-safe wallet provisioning.
- Deployment isolation.

Core principle:

> A crash should delay a payment, not duplicate value or create a second wallet.

Source: ./docs/clearing-engine.md, ./docs/wallet.md, ./docs/deployment.md

# 18. Compliance and Auditability

Explain the crypto-only MVP position:

- No KYC in the current payment flow.
- Screening is an adapter seam.
- No claim is made that “not screened” means “cleared.”
- Stablecoin freeze risk remains a real concern.

Describe the audit record:

- Payment intent.
- Clearing history.
- Ledger postings.
- Chain deposits.
- Payment completion event.
- Reconciliation result.

Use the three reconciliation states:

- MATCHED
- MISMATCHED
- NO_ON_CHAIN_RECORD

Explain that the compliance layer reads existing append-only facts instead of creating a second, drifting copy of the truth.

Source: ./docs/compliance.md

# 19. Threat Model and Accepted Risks

Do not present Mayarin as risk-free.

The whitepaper should explicitly discuss:

## Stablecoin depeg

Mayarin guarantees an amount in the settlement stablecoin, not a guaranteed fiat value after a depeg.

## Deposit-path operator custody

The treasury executor temporarily holds payer assets while sweeping and submitting the settlement transaction.

## Quote-signing key compromise

A compromised signer may authorize malicious orders, so the system uses:

- KMS or equivalent protected signing.
- Timelocked signer rotation.
- Multisig governance.
- Router pause capability.
- Merchant Safe allowlists.

## Chain and provider risks

- Reorganizations.
- RPC failures.
- Oracle disagreement.
- DEX liquidity failure.
- Issuer freezes.
- Smart-contract vulnerabilities.
- Provider outages.

The whitepaper should separate:

- Risks solved by invariants.
- Risks reduced by controls.
- Risks accepted for now.
- Risks deferred to future phases.

Source: ./docs/threat-model.md, ./docs/quote-signing.md

# 20. Deployment and Operational Trust

Include a short operational architecture section:

- Separate testnet and mainnet projects.
- Separate databases.
- Separate keys.
- Separate RPC configurations.
- Separate treasury addresses.
- Manual deployment gates.
- Mainnet confirmation phrase.
- No automatic deployment on push.
- Core API, dashboard API, chain worker, and PostgreSQL separation.

This demonstrates that operational safety is part of the protocol design, not an afterthought.

Source: ./docs/deployment.md

# 21. AI-Native Payments and Agent Pay

This should be presented as a future extension, not as shipped functionality unless implementation exists.

## Potential use cases

- An AI assistant discovers a merchant payment link.
- An agent requests a quote.
- An agent selects an approved payer asset.
- An agent asks the user for approval.
- The agent creates a payment intent.
- The user signs or confirms the transaction.
- Mayarin settles and returns a verifiable payment result.
- The agent receives a structured status event.

## MCP integration possibility

An MCP server could expose tools such as:

- create_payment_intent
- quote_payment
- list_supported_assets
- get_payment_status
- get_checkout_url
- request_user_approval
- verify_payment

Agents should not receive unrestricted wallet access.

## Required controls

Before agents can move real funds, define:

- Agent identity.
- Merchant and user authorization.
- Scoped API keys.
- Spending limits.
- Per-transaction limits.
- Daily or monthly budgets.
- Approved merchants.
- Approved assets and chains.
- Human approval thresholds.
- Expiration and nonce rules.
- Idempotency.
- Replay protection.
- Full audit logs.
- Refund and dispute handling.
- Emergency revocation.
- Clear responsibility between user, agent, merchant, and Mayarin.

The key positioning:

> Mayarin could become a settlement and policy layer for machine-initiated commerce, while keeping the final authority with the user or merchant.

# 22. Economics and Fee Model

The whitepaper should explain:

- Who pays network gas.
- How Mayarin earns fees.
- How fees are separated from merchant settlement.
- What happens when swap output exceeds or falls below the locked amount.
- Why Mayarin does not maintain an open-ended FX treasury.
- What operational costs exist for deposit execution, RPCs, custody providers, and infrastructure.

Avoid presenting a business model that the code or documentation does not yet define.

# 23. Roadmap

Use the existing roadmap, but separate shipped capabilities from future possibilities.

## Current foundation

- Payment intents.
- Clearing engine.
- Ledger.
- Chain watcher.
- Stablecoin registry.
- Liquidity router.
- PaymentRouter.
- Quote engine.
- Settlement indexer.
- Merchant wallets.
- Dashboard and SDK surfaces.

## Commerce expansion

- Production checkout.
- Wallet onboarding.
- Refund and fee split.
- Gas abstraction.
- Compliance tooling.

## Multi-asset and multi-chain

- More ERC-20 payer assets.
- More execution venues.
- Additional EVM chains.
- Solana.
- TRON.
- Configurable settlement assets.

## Open infrastructure

- Provider SDK.
- Plugin SDK.
- Adapter marketplace.
- Event streaming.
- High availability.
- Multi-region infrastructure.

## AI and agent commerce

- Agent Pay-compatible flows.
- MCP tools.
- Policy-controlled agent payments.
- Human-in-the-loop authorization.
- Machine-readable payment receipts.

## Explicitly later

- Stablecoin-to-fiat off-ramp.
- Fiat rails.
- Cross-chain settlement with a separately defined bridge trust model.

Source: ./docs/roadmap.md

# 24. Conclusion

End with the strongest summary:

Mayarin makes crypto commerce usable without forcing every merchant to become a wallet operator, trader, blockchain engineer, or accountant.

Its central promise is:

One integration.
Any supported payer asset.
Predictable stablecoin settlement.
Auditable value movement.
Merchant-controlled funds.

# Recommended Appendices

Add these after the main narrative:

- Appendix A: Payment lifecycle state machine.
- Appendix B: Contract order structure.
- Appendix C: Ledger posting examples.
- Appendix D: Quote and slippage mathematics.
- Appendix E: Supported assets and chains.
- Appendix F: Custody and key hierarchy.
- Appendix G: Threat model.
- Appendix H: API and SDK examples.
- Appendix I: Reconciliation examples.
- Appendix J: AI/MCP authorization model.
- Appendix K: Glossary.
- Appendix L: Current implementation status and testnet evidence.

The most important writing rule is to clearly label every statement as one of:

- Implemented and verified.
- Implemented but still dependent on external providers.
- Planned.
- An accepted risk.
- A future possibility.

That distinction will make the whitepaper credible, especially for the AI, custody, settlement, and cross-chain sections.
