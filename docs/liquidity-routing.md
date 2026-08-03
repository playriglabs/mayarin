[← Documentation index](./README.md)

# Liquidity & Routing

Turning any supported digital asset into the configured settlement asset, as
cheaply as possible.

> Not yet implemented — Phase 2. Phase 1 locks prices against a configured table
> through the same `RateProvider` port these components will implement. Phase 4's
> smart routing then optimizes over liquidity, settlement, retries and treasury
> on top of it.

---

## Liquidity Router

Responsible for routing digital assets into the configured settlement asset.

Example

```
ETH

↓

USDC

↓

Settlement Asset
```

Responsibilities

- Price discovery
- Swap execution
- Route optimization
- Liquidity selection
- Slippage protection

Future integrations

- Uniswap
- 0x API
- 1inch
- LI.FI

---

---

## Smart Routing Engine

Optimizes payment execution.

Responsibilities

- Select best liquidity source
- Minimize swap costs
- Select optimal blockchain
- Retry failed settlements
- Optimize treasury allocation

Example

```
USDC

↓

Base

0.05%

↓

Selected
```

---

## Related

- [Clearing Engine](./clearing-engine.md)
- [Money](./money.md)

[← Documentation index](./README.md)
