[← Back to the project README](../README.md)

# Documentation

Mayarr's reference documentation. Start with the [architecture](./architecture.md)
if you are here to change code, or the [vision](./vision.md) if you are here to
understand why any of it exists.

---

## Orientation

| Document                          | Read it when                                                   |
| --------------------------------- | -------------------------------------------------------------- |
| [Vision & Rationale](./vision.md) | You want the problem, the goals, and what Mayarr refuses to be |
| [Architecture](./architecture.md) | You need the layers, the payment flow, and where code lives    |
| [Development](./development.md)   | You are running it locally or touching the tooling             |
| [REST API](./api.md)              | You are integrating against it                                 |
| [Roadmap](./roadmap.md)           | You want to know what is shipped and what is next              |

---

## Core Components

Each of Mayarr's components is documented on its own page, in the order value
moves through them.

| Component                                     | Responsibility                                              |
| --------------------------------------------- | ----------------------------------------------------------- |
| [Money](./money.md)                           | Exact amounts and the asset registry every component shares |
| [QR Parser](./qr-parser.md)                   | Decoding payment payloads into a normalized shape           |
| [Payment Intent](./payment-intent.md)         | Immutable payment requests and their lifecycle              |
| [Liquidity & Routing](./liquidity-routing.md) | Converting assets into the settlement asset _(planned)_     |
| [Clearing Engine](./clearing-engine.md)       | The state machine every payment passes through              |
| [Double Entry Ledger](./ledger.md)            | Recording every movement of value                           |
| [Settlement](./settlement.md)                 | Handing value to a payment rail                             |

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

> **Build once. Settle anywhere.**
