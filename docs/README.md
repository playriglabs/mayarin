[← Back to the project README](../README.md)

# Documentation

Mayarin's reference documentation. Start with the [architecture](./architecture.md)
if you are here to change code, or the [vision](./vision.md) if you are here to
understand why any of it exists.

Merchant-facing API guides, SDK reference, and the interactive OpenAPI
playground live in `apps/docs` and publish to `docs.mayarin.xyz`. This directory
remains the repository's architecture and design record.

---

## Orientation

| Document                               | Read it when                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| [Vision & Rationale](./vision.md)      | You want the problem, the goals, and what Mayarin refuses to be              |
| [Architecture](./architecture.md)      | You need the layers, the payment flow, and where code lives                  |
| [Development](./development.md)        | You are running it locally or touching the tooling                           |
| [Deployment Targets](./deployment.md)  | You are manually deploying testnet or preparing the mainnet perimeter        |
| [REST API](./api.md)                   | Contributor pointer to the public reference, plus the internal dashboard API |
| [Embeddable Checkout](./embed.md)      | You are putting the checkout on a merchant's own page                        |
| [WooCommerce Plugin](./woocommerce.md) | You are taking payments in a WooCommerce store                               |
| [Roadmap](./roadmap.md)                | You want to know what is shipped and what is next                            |
| [Threat Model](./threat-model.md)      | You want the risks the design carries, and the ones it does not yet answer   |
| [Quote Signing](./quote-signing.md)    | You are touching the EIP-712 order or the signing key                        |

---

## Core Components

Each of Mayarin's components is documented on its own page, in the order value
moves through them.

| Component                                     | Responsibility                                                             |
| --------------------------------------------- | -------------------------------------------------------------------------- |
| [Money](./money.md)                           | Exact amounts and the asset registry every component shares                |
| [QR Parser](./qr-parser.md)                   | Decoding payment payloads into a normalized shape                          |
| [Payment Intent](./payment-intent.md)         | Immutable payment requests and their lifecycle                             |
| [Chain Layer](./chain.md)                     | Per-intent deposit addresses, the wallet watcher, and reorg policy         |
| [Stablecoin Registry](./stablecoin.md)        | The admissible stablecoins and their on-chain identities                   |
| [Liquidity & Routing](./liquidity-routing.md) | Converting assets into the settlement asset via a pluggable price source   |
| [Clearing Engine](./clearing-engine.md)       | The state machine every payment passes through                             |
| [Double Entry Ledger](./ledger.md)            | Recording every movement of value                                          |
| [Settlement](./settlement.md)                 | Handing value to a payment rail                                            |
| [Merchant Wallets](./wallet.md)               | Proving control of a payout address, and provisioning a self-custodial one |
| [Compliance](./compliance.md)                 | The audit trail, and reconciling the ledger against the chain              |

---

## Conventions

- **Money is never a float.** Every amount is an integer count of an asset's
  minor units. See [Money](./money.md).
- **Domain packages define ports; adapters implement them.** Storage and
  providers are swappable because nothing in `packages/core` depends on a
  concrete one. See [Architecture](./architecture.md).
- **Nothing mutates a balance directly.** Value moves only through balanced
  ledger postings. See [Double Entry Ledger](./ledger.md).

---

> **Price in fiat. Settle in stablecoins. Pay with anything.**
