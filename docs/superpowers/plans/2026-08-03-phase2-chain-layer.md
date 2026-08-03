# Phase 2A Chain Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every payment intent its own on-chain deposit address, watch EVM chains for the payer's stablecoin transfer, and drive the existing `PAYMENT_PENDING → ASSET_RECEIVED` transition once the money is confirmed.

**Architecture:** A pure `packages/core/chain` holds the ports, the confirmation/reorg policy and the watcher algorithm; `packages/providers/evm` implements the ports with viem; `packages/providers/mock-chain` implements them with a scriptable fake chain so every policy test is deterministic and offline. The watcher never imports the clearing engine — it calls an `AssetReceiptSink` port that `apps/api/src/container.ts` wires to `engine.recordAssetReceived`.

**Tech Stack:** Bun workspaces, TypeScript (strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`), Hono, Drizzle + Postgres, Zod, viem.

**Spec:** `docs/superpowers/specs/2026-08-03-phase2-chain-layer-design.md`. Read it before Task 1.

## Global Constraints

- **Ports and adapters.** Nothing under `packages/core/*` may import a concrete adapter, a chain library, a database driver or HTTP. `packages/core/chain` must not import `@mayarin/clearing`.
- **Money is never a float.** A `Money` is `{ amount: bigint; asset: AssetCode }`. Rates are integers (minor units of target per whole unit of source). Never `number` for an amount.
- **No `Date.now()` in domain code.** Inject a `Clock`; tests use `FixedClock`.
- **Expected failures throw.** Every domain error extends `MayarinError` from `packages/shared/src/errors.ts` and carries `code` and `retryable`. Do not add new error classes in this plan — the taxonomy already covers every case (see spec, "Errors").
- **Optional values are `T | undefined`**, never `null`, inside domain packages. `null` appears only in repository return types (`findX(): Promise<T | null>`) and in JSON responses, matching the existing code.
- **Imports use explicit `.ts` extensions** inside a package; cross-package imports go through `@mayarin/*` workspace names.
- **Biome bans `any`, non-null assertions and untyped throws** (`any` is relaxed in test files only). Biome owns TS/JS/JSON; Prettier owns Markdown/YAML.
- **Commit messages carry no Claude or Anthropic attribution trailer.**
- **New optional fields only.** Every aggregate change in this plan is an optional field. No existing test may need editing to keep passing. If one does, the change is wrong.
- **Verification command for every task:** `bun run typecheck && bun test`. A task is not done until both pass.

---

## File Structure

**New package `packages/core/chain`** (`@mayarin/chain`) — pure, no dependencies beyond `@mayarin/shared`:

| File                | Responsibility                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/types.ts`      | `ChainId`, `BlockRef`, `TransferLog`, `Deposit`, `DepositStatus`, `DepositAddress`, `WatchedAddress` |
| `src/policy.ts`     | `confirmationsOf`, `classifyDeposit`, `ConfirmationPolicy` — pure, no I/O                            |
| `src/client.ts`     | `ChainClient`, `TransferQuery`, `DepositAddressDeriver`, `AssetReceiptSink` ports                    |
| `src/repository.ts` | `DepositAddressRepository`, `DepositRepository`, `WatcherCursorRepository` ports                     |
| `src/watcher.ts`    | `WalletWatcher` — one `tick()` per `(chain, asset)`                                                  |
| `src/events.ts`     | `depositOrphanedEvent` — builds the `chain.deposit.orphaned` `DomainEvent`                           |
| `src/index.ts`      | barrel                                                                                               |

**New package `packages/providers/mock-chain`** (`@mayarin/provider-mock-chain`) — `FakeChainClient` with `mine`, `transfer`, `reorg`; `FixedDepositAddressDeriver`.

**New package `packages/providers/evm`** (`@mayarin/provider-evm`) — `EvmChainClient` (viem), `HdDepositAddressDeriver` (viem `HDKey`).

**Modified:**

| File                                             | Change                                                |
| ------------------------------------------------ | ----------------------------------------------------- |
| `packages/shared/src/id.ts`                      | two new ID prefixes                                   |
| `packages/core/payment-intent/src/types.ts`      | optional `payment` leg                                |
| `packages/core/payment-intent/src/intent.ts`     | carry `payment` through creation                      |
| `packages/core/payment-intent/src/service.ts`    | `payment` on the create command + fingerprint         |
| `packages/core/clearing/src/types.ts`            | optional `deposit` block                              |
| `packages/core/clearing/src/engine.ts`           | second rate lock + address allocation in `#lockPrice` |
| `packages/db/src/schema.ts`                      | 3 new tables, 8 new columns                           |
| `packages/db/src/memory/chain.ts`                | in-memory chain repositories (new file)               |
| `packages/db/src/repositories/chain.ts`          | Drizzle chain repositories (new file)                 |
| `packages/db/src/repositories/clearing.ts`       | map the `deposit` block                               |
| `packages/db/src/repositories/payment-intent.ts` | map the `payment` leg                                 |
| `apps/api/src/config.ts`                         | chain configuration block                             |
| `apps/api/src/container.ts`                      | nullable chain wiring                                 |
| `apps/api/src/index.ts`                          | watcher interval                                      |
| `apps/api/src/app.ts`                            | mount admin routes                                    |
| `apps/api/src/routes/admin.ts`                   | `POST /admin/watcher/tick` (new file)                 |
| `apps/api/src/routes/payment-intents.ts`         | accept `payment` in the body                          |
| `apps/api/src/serialization.ts`                  | `deposit` block on the payment DTO                    |

---

### Task 1: Chain package skeleton, types and confirmation policy

The whole subsystem rests on two pure functions. Build and test them before anything can call them.

**Files:**

- Create: `packages/core/chain/package.json`
- Create: `packages/core/chain/tsconfig.json`
- Create: `packages/core/chain/src/types.ts`
- Create: `packages/core/chain/src/policy.ts`
- Create: `packages/core/chain/src/index.ts`
- Modify: `packages/shared/src/id.ts:17-25` (the `ID_PREFIXES` object)
- Test: `packages/core/chain/test/policy.test.ts`

**Interfaces:**

- Consumes: `AssetCode`, `Money` from `@mayarin/shared`.
- Produces: `ChainId`, `BlockRef`, `TransferLog`, `DepositStatus`, `Deposit`, `DepositAddress`, `WatchedAddress`, `ConfirmationPolicy`, `confirmationsOf(blockNumber: bigint, headNumber: bigint): number`, `classifyDeposit(input: ClassifyDepositInput): DepositStatus`, `isWithinReorgWatch(confirmations: number, policy: ConfirmationPolicy): boolean`.

- [ ] **Step 1: Create the package manifest and tsconfig**

`packages/core/chain/package.json`:

```json
{
  "name": "@mayarin/chain",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@mayarin/shared": "workspace:*"
  }
}
```

`packages/core/chain/tsconfig.json`:

```json
{
  "extends": "../../../tsconfig.base.json",
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

Then run `bun install` so the workspace link is created.

- [ ] **Step 2: Add the two new ID prefixes**

In `packages/shared/src/id.ts`, inside `ID_PREFIXES`, add two entries after `settlement: "stl",`:

```ts
  depositAddress: "dad",
  deposit: "dep",
```

- [ ] **Step 3: Write the types**

`packages/core/chain/src/types.ts`:

```ts
/**
 * Chain layer types.
 *
 * A deposit is an *observation*, not a posting. Nothing here touches a ledger
 * account: the ledger entry for a funded payment is the clearing engine's
 * existing `assetReceivedPosting`, unchanged.
 */

import type { AssetCode, Money } from "@mayarin/shared";

/** EVM chains Phase 2A watches. Phase 2B widens this. */
export const CHAIN_IDS = ["base", "base-sepolia"] as const;

export type ChainId = (typeof CHAIN_IDS)[number];

export function isChainId(value: unknown): value is ChainId {
  return (
    typeof value === "string" &&
    (CHAIN_IDS as readonly string[]).includes(value)
  );
}

/** A block identified by both height and hash — the hash is what detects a reorg. */
export interface BlockRef {
  readonly number: bigint;
  readonly hash: string;
}

/** An ERC-20 `Transfer` as read from the chain, before any policy is applied. */
export interface TransferLog {
  readonly chain: ChainId;
  readonly asset: AssetCode;
  readonly txHash: string;
  readonly logIndex: number;
  readonly blockNumber: bigint;
  readonly blockHash: string;
  readonly from: string;
  readonly to: string;
  /** Raw token amount, in the asset's minor units. */
  readonly amount: bigint;
}

/**
 * Deposit lifecycle.
 *
 * `PENDING` has touched nothing and can still disappear. `CONFIRMED` is past
 * the configured depth and is the only status that can fund a payment.
 * `ORPHANED` was reorged away.
 */
export const DEPOSIT_STATUSES = ["PENDING", "CONFIRMED", "ORPHANED"] as const;

export type DepositStatus = (typeof DEPOSIT_STATUSES)[number];

export interface Deposit {
  readonly id: string;
  readonly chain: ChainId;
  readonly txHash: string;
  readonly logIndex: number;
  readonly address: string;
  readonly amount: Money;
  readonly blockNumber: bigint;
  readonly blockHash: string;
  readonly status: DepositStatus;
  readonly firstSeenAt: Date;
  readonly confirmedAt?: Date;
  readonly orphanedAt?: Date;
}

/** A deposit that was counted and then reorged away — the case needing a human. */
export function isOrphanedAfterConfirmed(deposit: Deposit): boolean {
  return deposit.confirmedAt !== undefined && deposit.orphanedAt !== undefined;
}

export interface DepositAddress {
  readonly id: string;
  readonly clearingTransactionId: string;
  /** BIP-32 index. Persisting it is what makes the address re-derivable. */
  readonly derivationIndex: number;
  readonly chain: ChainId;
  readonly asset: AssetCode;
  readonly address: string;
  readonly createdAt: Date;
}

/** An address the watcher scans for, joined to what its payment expects. */
export interface WatchedAddress {
  readonly clearingTransactionId: string;
  readonly chain: ChainId;
  readonly asset: AssetCode;
  readonly address: string;
  readonly requiredAmount: Money;
  /** False once the clearing transaction is terminal: still recorded, never funds. */
  readonly fundable: boolean;
}
```

- [ ] **Step 4: Write the failing policy test**

`packages/core/chain/test/policy.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  classifyDeposit,
  confirmationsOf,
  isWithinReorgWatch,
} from "../src/policy.ts";

const policy = { depth: 6, reorgWatchWindow: 2 } as const;

describe("confirmationsOf", () => {
  test("a transaction in the head block has one confirmation", () => {
    expect(confirmationsOf(100n, 100n)).toBe(1);
  });

  test("counts inclusively from the deposit's block to the head", () => {
    expect(confirmationsOf(95n, 100n)).toBe(6);
  });

  test("a block above the head has no confirmations yet", () => {
    expect(confirmationsOf(101n, 100n)).toBe(0);
  });
});

describe("classifyDeposit", () => {
  test("stays PENDING below the configured depth", () => {
    expect(
      classifyDeposit({
        current: "PENDING",
        blockNumber: 96n,
        blockHash: "0xaa",
        headNumber: 100n,
        canonicalHash: "0xaa",
        policy,
      }),
    ).toBe("PENDING");
  });

  test("becomes CONFIRMED at exactly the configured depth", () => {
    expect(
      classifyDeposit({
        current: "PENDING",
        blockNumber: 95n,
        blockHash: "0xaa",
        headNumber: 100n,
        canonicalHash: "0xaa",
        policy,
      }),
    ).toBe("CONFIRMED");
  });

  test("a hash mismatch orphans the deposit whatever its depth", () => {
    expect(
      classifyDeposit({
        current: "CONFIRMED",
        blockNumber: 95n,
        blockHash: "0xaa",
        headNumber: 100n,
        canonicalHash: "0xbb",
        policy,
      }),
    ).toBe("ORPHANED");
  });

  test("a height the chain has not reached leaves the deposit PENDING", () => {
    expect(
      classifyDeposit({
        current: "PENDING",
        blockNumber: 101n,
        blockHash: "0xaa",
        headNumber: 100n,
        canonicalHash: undefined,
        policy,
      }),
    ).toBe("PENDING");
  });

  test("an already-orphaned deposit is terminal", () => {
    expect(
      classifyDeposit({
        current: "ORPHANED",
        blockNumber: 95n,
        blockHash: "0xaa",
        headNumber: 100n,
        canonicalHash: "0xaa",
        policy,
      }),
    ).toBe("ORPHANED");
  });
});

describe("isWithinReorgWatch", () => {
  test("watches up to depth times the window", () => {
    expect(isWithinReorgWatch(12, policy)).toBe(true);
  });

  test("stops probing past the window", () => {
    expect(isWithinReorgWatch(13, policy)).toBe(false);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `bun test packages/core/chain/test/policy.test.ts`
Expected: FAIL — `Cannot find module '../src/policy.ts'`.

- [ ] **Step 6: Write the policy**

`packages/core/chain/src/policy.ts`:

```ts
/**
 * Confirmation and reorg policy.
 *
 * Pure functions over numbers and hashes: no chain client, no repository, no
 * clock. Confirmation depth is the finality line — a deposit below it has
 * touched nothing and can vanish freely; at or above it, the deposit may fund a
 * payment, and losing it afterwards is a fact to record rather than a state to
 * undo.
 */

import type { DepositStatus } from "./types.ts";

export interface ConfirmationPolicy {
  /** Confirmations required before a deposit may fund a payment. */
  readonly depth: number;
  /**
   * How far past `depth` to keep probing for a reorg, as a multiple of it.
   * Bounds the work: past `depth * reorgWatchWindow` a deposit is final.
   */
  readonly reorgWatchWindow: number;
}

/** Confirmations counted inclusively: a deposit in the head block has one. */
export function confirmationsOf(
  blockNumber: bigint,
  headNumber: bigint,
): number {
  if (blockNumber > headNumber) return 0;
  return Number(headNumber - blockNumber) + 1;
}

export function isWithinReorgWatch(
  confirmations: number,
  policy: ConfirmationPolicy,
): boolean {
  return confirmations <= policy.depth * policy.reorgWatchWindow;
}

export interface ClassifyDepositInput {
  readonly current: DepositStatus;
  readonly blockNumber: bigint;
  /** Hash of the block the deposit was seen in. */
  readonly blockHash: string;
  readonly headNumber: bigint;
  /** Hash the chain currently reports at that height; `undefined` past the head. */
  readonly canonicalHash: string | undefined;
  readonly policy: ConfirmationPolicy;
}

export function classifyDeposit(input: ClassifyDepositInput): DepositStatus {
  // Orphaned is terminal: a block that left the canonical chain does not return
  // under the same hash, and re-confirming one would erase the audit trail.
  if (input.current === "ORPHANED") return "ORPHANED";

  // No hash to compare against means the chain has not reached that height yet
  // — during a deep reorg the head can briefly sit below a known deposit. That
  // is not evidence of an orphan, so hold at PENDING.
  if (input.canonicalHash === undefined) return "PENDING";

  if (input.canonicalHash !== input.blockHash) return "ORPHANED";

  const confirmations = confirmationsOf(input.blockNumber, input.headNumber);
  return confirmations >= input.policy.depth ? "CONFIRMED" : "PENDING";
}
```

- [ ] **Step 7: Write the barrel**

`packages/core/chain/src/index.ts`:

```ts
export * from "./policy.ts";
export * from "./types.ts";
```

- [ ] **Step 8: Run the tests and typecheck**

Run: `bun test packages/core/chain && bun run typecheck`
Expected: 10 tests pass, typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add packages/core/chain packages/shared/src/id.ts package.json bun.lock
git commit -m "feat(chain): add the confirmation and reorg policy

Confirmation depth is the finality line. Below it a deposit has touched
nothing, so a reorg is a status change; at or above it the deposit may fund a
payment, and an orphan afterwards is a fact to record rather than a state to
undo — which is why ORPHANED is terminal here."
```

---

### Task 2: Ports and the scriptable fake chain

The fake chain is the test substrate for everything that follows. It must model reorgs honestly — re-mining a fork with different hashes — or every later test passes for the wrong reason.

**Files:**

- Create: `packages/core/chain/src/client.ts`
- Create: `packages/core/chain/src/repository.ts`
- Create: `packages/providers/mock-chain/package.json`
- Create: `packages/providers/mock-chain/tsconfig.json`
- Create: `packages/providers/mock-chain/src/fake-chain.ts`
- Create: `packages/providers/mock-chain/src/deriver.ts`
- Create: `packages/providers/mock-chain/src/index.ts`
- Modify: `packages/core/chain/src/index.ts`
- Test: `packages/providers/mock-chain/test/fake-chain.test.ts`

**Interfaces:**

- Consumes: `ChainId`, `BlockRef`, `TransferLog`, `Deposit`, `DepositAddress`, `WatchedAddress`, `DepositStatus` from Task 1.
- Produces: `ChainClient`, `TransferQuery`, `DepositAddressDeriver`, `AssetReceiptSink`, `DepositAddressRepository`, `DepositRepository`, `WatcherCursorRepository`, `AllocateDepositAddress`, `DepositStatusUpdate`, `FakeChainClient`, `FixedDepositAddressDeriver`.

- [ ] **Step 1: Write the client ports**

`packages/core/chain/src/client.ts`:

```ts
/**
 * Chain ports.
 *
 * Three narrow interfaces, deliberately: reading the chain, deriving an
 * address, and telling something that money arrived. Keeping them apart is what
 * lets `core/chain` stay free of both viem and the clearing engine.
 */

import type { AssetCode } from "@mayarin/shared";
import type { BlockRef, ChainId, TransferLog } from "./types.ts";

export interface TransferQuery {
  readonly chain: ChainId;
  readonly asset: AssetCode;
  readonly fromBlock: bigint;
  readonly toBlock: bigint;
  /** Only transfers *to* these addresses. Empty means the query is skipped. */
  readonly addresses: readonly string[];
}

export interface ChainClient {
  head(chain: ChainId): Promise<BlockRef>;
  /** Canonical hash at a height, or `null` past the head. Drives the reorg probe. */
  blockHash(chain: ChainId, number: bigint): Promise<string | null>;
  transfers(query: TransferQuery): Promise<TransferLog[]>;
}

/**
 * Derives a deposit address from a BIP-32 index.
 *
 * A port so that secp256k1 and BIP-32 stay out of `core`. The implementation
 * holds a watch-only extended public key and cannot sign.
 */
export interface DepositAddressDeriver {
  derive(index: number): string;
}

/**
 * What the watcher calls once a payment is fully funded.
 *
 * A port rather than a direct dependency: `core/chain` must not import
 * `@mayarin/clearing`. The composition root wires this to
 * `ClearingEngine.recordAssetReceived`.
 */
export interface AssetReceiptSink {
  fund(clearingTransactionId: string): Promise<void>;
}
```

- [ ] **Step 2: Write the repository ports**

`packages/core/chain/src/repository.ts`:

```ts
/**
 * Chain persistence ports.
 *
 * Two idempotency guarantees live here, and both are enforced by a unique
 * index rather than by application logic: one deposit address per clearing
 * transaction, and one row per `(chain, txHash, logIndex)`.
 */

import type { AssetCode, Money } from "@mayarin/shared";
import type {
  ChainId,
  Deposit,
  DepositAddress,
  DepositStatus,
  TransferLog,
  WatchedAddress,
} from "./types.ts";

export interface AllocateDepositAddress {
  readonly clearingTransactionId: string;
  readonly chain: ChainId;
  readonly asset: AssetCode;
  readonly deriver: { derive(index: number): string };
  readonly now: Date;
}

export interface DepositAddressRepository {
  /**
   * Allocates the next derivation index and stores the derived address.
   * Idempotent: a second call for the same clearing transaction returns the
   * address already allocated, so a replayed PRICE_LOCKED step cannot hand a
   * payer a second address.
   */
  allocate(input: AllocateDepositAddress): Promise<DepositAddress>;
  findByClearingTransactionId(
    clearingTransactionId: string,
  ): Promise<DepositAddress | null>;
  /**
   * Addresses to scan. Non-terminal transactions are `fundable`; those that
   * went terminal since `retainTerminalSince` are returned unfundable, so a
   * late transfer is still recorded rather than lost.
   */
  listWatched(
    chain: ChainId,
    retainTerminalSince: Date,
  ): Promise<WatchedAddress[]>;
}

export interface DepositStatusUpdate {
  readonly id: string;
  readonly status: DepositStatus;
  readonly at: Date;
}

export interface DepositRepository {
  /** Upsert on `(chain, txHash, logIndex)`. Replaying a log cannot double-count. */
  record(transfers: readonly TransferLog[], now: Date): Promise<Deposit[]>;
  /** Non-terminal or recently-confirmed deposits worth re-probing, oldest first. */
  listProbable(chain: ChainId, limit: number): Promise<Deposit[]>;
  updateStatuses(updates: readonly DepositStatusUpdate[]): Promise<void>;
  listByAddress(chain: ChainId, address: string): Promise<Deposit[]>;
  /** Sum of CONFIRMED deposits at an address. The number the funding rule uses. */
  confirmedTotal(
    chain: ChainId,
    address: string,
    asset: AssetCode,
  ): Promise<Money>;
}

export interface WatcherCursorRepository {
  get(chain: ChainId, asset: AssetCode): Promise<bigint | null>;
  set(chain: ChainId, asset: AssetCode, block: bigint): Promise<void>;
}
```

- [ ] **Step 3: Extend the barrel**

`packages/core/chain/src/index.ts` becomes:

```ts
export * from "./client.ts";
export * from "./policy.ts";
export * from "./repository.ts";
export * from "./types.ts";
```

- [ ] **Step 4: Create the mock-chain package manifest**

`packages/providers/mock-chain/package.json`:

```json
{
  "name": "@mayarin/provider-mock-chain",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@mayarin/chain": "workspace:*",
    "@mayarin/shared": "workspace:*"
  }
}
```

`packages/providers/mock-chain/tsconfig.json`:

```json
{
  "extends": "../../../tsconfig.base.json",
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

Run `bun install`.

- [ ] **Step 5: Write the failing fake-chain test**

`packages/providers/mock-chain/test/fake-chain.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { FakeChainClient } from "../src/fake-chain.ts";

const CHAIN = "base-sepolia" as const;
const ALICE = "0x0000000000000000000000000000000000000a11";
const BOB = "0x0000000000000000000000000000000000000b0b";

describe("FakeChainClient", () => {
  test("starts at block zero", async () => {
    const chain = new FakeChainClient();
    expect((await chain.head(CHAIN)).number).toBe(0n);
  });

  test("mining advances the head and gives each block a distinct hash", async () => {
    const chain = new FakeChainClient();
    chain.mine(3);
    const head = await chain.head(CHAIN);
    expect(head.number).toBe(3n);
    expect(await chain.blockHash(CHAIN, 1n)).not.toBe(
      await chain.blockHash(CHAIN, 2n),
    );
  });

  test("a transfer lands in the next mined block", async () => {
    const chain = new FakeChainClient();
    chain.transfer({ asset: "USDC", to: ALICE, amount: 1_000_000n });
    chain.mine(1);

    const logs = await chain.transfers({
      chain: CHAIN,
      asset: "USDC",
      fromBlock: 1n,
      toBlock: 1n,
      addresses: [ALICE],
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]?.amount).toBe(1_000_000n);
    expect(logs[0]?.blockNumber).toBe(1n);
  });

  test("filters by recipient", async () => {
    const chain = new FakeChainClient();
    chain.transfer({ asset: "USDC", to: BOB, amount: 5n });
    chain.mine(1);

    const logs = await chain.transfers({
      chain: CHAIN,
      asset: "USDC",
      fromBlock: 1n,
      toBlock: 1n,
      addresses: [ALICE],
    });

    expect(logs).toHaveLength(0);
  });

  test("filters by asset", async () => {
    const chain = new FakeChainClient();
    chain.transfer({ asset: "USDT", to: ALICE, amount: 5n });
    chain.mine(1);

    const logs = await chain.transfers({
      chain: CHAIN,
      asset: "USDC",
      fromBlock: 1n,
      toBlock: 1n,
      addresses: [ALICE],
    });

    expect(logs).toHaveLength(0);
  });

  test("a reorg replaces block hashes from the fork point", async () => {
    const chain = new FakeChainClient();
    chain.mine(5);
    const before = await chain.blockHash(CHAIN, 5n);
    const untouched = await chain.blockHash(CHAIN, 3n);

    chain.reorg({ depth: 2 });

    expect(await chain.blockHash(CHAIN, 5n)).not.toBe(before);
    expect(await chain.blockHash(CHAIN, 3n)).toBe(untouched);
    expect((await chain.head(CHAIN)).number).toBe(5n);
  });

  test("a reorg drops the transfers that were in the replaced blocks", async () => {
    const chain = new FakeChainClient();
    chain.mine(3);
    chain.transfer({ asset: "USDC", to: ALICE, amount: 7n });
    chain.mine(1);

    chain.reorg({ depth: 1 });

    const logs = await chain.transfers({
      chain: CHAIN,
      asset: "USDC",
      fromBlock: 1n,
      toBlock: 4n,
      addresses: [ALICE],
    });
    expect(logs).toHaveLength(0);
  });

  test("returns null for a height above the head", async () => {
    const chain = new FakeChainClient();
    chain.mine(1);
    expect(await chain.blockHash(CHAIN, 9n)).toBeNull();
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `bun test packages/providers/mock-chain`
Expected: FAIL — `Cannot find module '../src/fake-chain.ts'`.

- [ ] **Step 7: Implement the fake chain**

`packages/providers/mock-chain/src/fake-chain.ts`:

```ts
/**
 * Scriptable in-memory chain.
 *
 * Models a reorg the way a chain does: blocks past the fork point are replaced
 * by new blocks with new hashes, and the transfers that were only in the
 * replaced blocks are gone. A fake that merely renumbered blocks would let
 * reorg tests pass without the policy ever being exercised.
 */

import type {
  BlockRef,
  ChainClient,
  ChainId,
  TransferLog,
  TransferQuery,
} from "@mayarin/chain";
import type { AssetCode } from "@mayarin/shared";

interface PendingTransfer {
  readonly asset: AssetCode;
  readonly from: string;
  readonly to: string;
  readonly amount: bigint;
}

interface Block {
  readonly number: bigint;
  readonly hash: string;
  readonly transfers: readonly PendingTransfer[];
}

export interface FakeTransferInput {
  readonly asset: AssetCode;
  readonly to: string;
  readonly amount: bigint;
  readonly from?: string;
}

const DEFAULT_SENDER = "0x00000000000000000000000000000000000000ff";

export class FakeChainClient implements ChainClient {
  readonly #blocks: Block[] = [];
  #pending: PendingTransfer[] = [];
  #epoch = 0;

  /** Queues a transfer for the next mined block. */
  transfer(input: FakeTransferInput): this {
    this.#pending.push({
      asset: input.asset,
      from: input.from ?? DEFAULT_SENDER,
      to: input.to.toLowerCase(),
      amount: input.amount,
    });
    return this;
  }

  /** Mines `count` blocks; queued transfers all land in the first of them. */
  mine(count = 1): this {
    for (let i = 0; i < count; i += 1) {
      const number = BigInt(this.#blocks.length + 1);
      this.#blocks.push({
        number,
        hash: this.#hashFor(number),
        transfers: this.#pending,
      });
      this.#pending = [];
    }
    return this;
  }

  /**
   * Replaces the top `depth` blocks with fresh empty ones at the same heights.
   * Bumping the epoch is what changes their hashes.
   */
  reorg({ depth }: { depth: number }): this {
    const keep = Math.max(0, this.#blocks.length - depth);
    const replaced = this.#blocks.length - keep;
    this.#blocks.length = keep;
    this.#epoch += 1;
    for (let i = 0; i < replaced; i += 1) {
      const number = BigInt(this.#blocks.length + 1);
      this.#blocks.push({ number, hash: this.#hashFor(number), transfers: [] });
    }
    return this;
  }

  async head(_chain: ChainId): Promise<BlockRef> {
    const last = this.#blocks.at(-1);
    if (last === undefined) return { number: 0n, hash: this.#hashFor(0n) };
    return { number: last.number, hash: last.hash };
  }

  async blockHash(_chain: ChainId, number: bigint): Promise<string | null> {
    const block = this.#blocks.find((candidate) => candidate.number === number);
    return block?.hash ?? null;
  }

  async transfers(query: TransferQuery): Promise<TransferLog[]> {
    if (query.addresses.length === 0) return [];
    const wanted = new Set(
      query.addresses.map((address) => address.toLowerCase()),
    );
    const logs: TransferLog[] = [];

    for (const block of this.#blocks) {
      if (block.number < query.fromBlock || block.number > query.toBlock)
        continue;

      block.transfers.forEach((transfer, logIndex) => {
        if (transfer.asset !== query.asset) return;
        if (!wanted.has(transfer.to)) return;
        logs.push({
          chain: query.chain,
          asset: transfer.asset,
          txHash: `0xtx${block.number}-${logIndex}-${this.#epoch}`,
          logIndex,
          blockNumber: block.number,
          blockHash: block.hash,
          from: transfer.from,
          to: transfer.to,
          amount: transfer.amount,
        });
      });
    }

    return logs;
  }

  #hashFor(number: bigint): string {
    return `0xblock-${number}-epoch-${this.#epoch}`;
  }
}
```

- [ ] **Step 8: Implement the fixed deriver**

`packages/providers/mock-chain/src/deriver.ts`:

```ts
/**
 * Deterministic address deriver for tests.
 *
 * Distinct per index and stable across runs, which is all the watcher cares
 * about. The real BIP-32 derivation lives in `@mayarin/provider-evm`.
 */

import type { DepositAddressDeriver } from "@mayarin/chain";

export class FixedDepositAddressDeriver implements DepositAddressDeriver {
  derive(index: number): string {
    return `0x${index.toString(16).padStart(40, "0")}`;
  }
}
```

`packages/providers/mock-chain/src/index.ts`:

```ts
export * from "./deriver.ts";
export * from "./fake-chain.ts";
```

- [ ] **Step 9: Run the tests and typecheck**

Run: `bun test packages/providers/mock-chain && bun run typecheck`
Expected: 8 tests pass, typecheck clean.

- [ ] **Step 10: Commit**

```bash
git add packages/core/chain packages/providers/mock-chain package.json bun.lock
git commit -m "feat(chain): add the chain ports and a scriptable fake chain

The fake replaces blocks past a fork point with new hashes rather than
renumbering them, so a reorg test cannot pass without the policy running."
```

---

### Task 3: In-memory chain repositories

Every later test needs storage. Building the in-memory versions first means the watcher can be developed and tested with no database at all — the same reason `packages/db/src/memory` exists for Phase 1.

**Files:**

- Create: `packages/db/src/memory/chain.ts`
- Modify: `packages/db/src/memory/index.ts`
- Modify: `packages/db/package.json` (add the `@mayarin/chain` dependency)
- Test: `packages/db/test/memory-chain.test.ts`

**Interfaces:**

- Consumes: the repository ports from Task 2.
- Produces: `InMemoryDepositAddressRepository`, `InMemoryDepositRepository`, `InMemoryWatcherCursorRepository`. The address repository takes a `resolveWatched` callback so it can join to clearing state without `@mayarin/db/memory` depending on the clearing engine:
  `new InMemoryDepositAddressRepository(resolve?: (id: string) => { fundable: boolean; requiredAmount: Money; terminalAt?: Date } | undefined)`.

- [ ] **Step 1: Add the dependency**

In `packages/db/package.json`, add to `dependencies`:

```json
    "@mayarin/chain": "workspace:*",
```

and to `devDependencies` (the test needs a deriver, and the fake one is not a runtime dependency):

```json
    "@mayarin/provider-mock-chain": "workspace:*"
```

Run `bun install`.

- [ ] **Step 2: Write the failing test**

`packages/db/test/memory-chain.test.ts`:

```ts
import type { TransferLog } from "@mayarin/chain";
import { FixedDepositAddressDeriver } from "@mayarin/provider-mock-chain";
import { money } from "@mayarin/shared";
import { describe, expect, test } from "bun:test";
import {
  InMemoryDepositAddressRepository,
  InMemoryDepositRepository,
  InMemoryWatcherCursorRepository,
} from "../src/memory/chain.ts";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const CHAIN = "base-sepolia" as const;
const deriver = new FixedDepositAddressDeriver();

function transferLog(overrides: Partial<TransferLog> = {}): TransferLog {
  return {
    chain: CHAIN,
    asset: "USDC",
    txHash: "0xtx1",
    logIndex: 0,
    blockNumber: 10n,
    blockHash: "0xb10",
    from: "0xfrom",
    to: deriver.derive(1),
    amount: 1_000_000n,
    ...overrides,
  };
}

describe("InMemoryDepositAddressRepository", () => {
  test("allocates increasing derivation indices", async () => {
    const repository = new InMemoryDepositAddressRepository();
    const first = await repository.allocate({
      clearingTransactionId: "clr_1",
      chain: CHAIN,
      asset: "USDC",
      deriver,
      now: NOW,
    });
    const second = await repository.allocate({
      clearingTransactionId: "clr_2",
      chain: CHAIN,
      asset: "USDC",
      deriver,
      now: NOW,
    });

    expect(second.derivationIndex).toBe(first.derivationIndex + 1);
    expect(second.address).not.toBe(first.address);
  });

  test("allocating twice for one transaction returns the same address", async () => {
    const repository = new InMemoryDepositAddressRepository();
    const first = await repository.allocate({
      clearingTransactionId: "clr_1",
      chain: CHAIN,
      asset: "USDC",
      deriver,
      now: NOW,
    });
    const again = await repository.allocate({
      clearingTransactionId: "clr_1",
      chain: CHAIN,
      asset: "USDC",
      deriver,
      now: NOW,
    });

    expect(again.address).toBe(first.address);
    expect(again.derivationIndex).toBe(first.derivationIndex);
  });

  test("lists non-terminal addresses as fundable", async () => {
    const repository = new InMemoryDepositAddressRepository(() => ({
      fundable: true,
      requiredAmount: money(1_000_000n, "USDC"),
    }));
    await repository.allocate({
      clearingTransactionId: "clr_1",
      chain: CHAIN,
      asset: "USDC",
      deriver,
      now: NOW,
    });

    const watched = await repository.listWatched(CHAIN, NOW);
    expect(watched).toHaveLength(1);
    expect(watched[0]?.fundable).toBe(true);
  });

  test("drops terminal addresses older than the retention cutoff", async () => {
    const repository = new InMemoryDepositAddressRepository(() => ({
      fundable: false,
      requiredAmount: money(1_000_000n, "USDC"),
      terminalAt: new Date("2025-12-01T00:00:00.000Z"),
    }));
    await repository.allocate({
      clearingTransactionId: "clr_1",
      chain: CHAIN,
      asset: "USDC",
      deriver,
      now: NOW,
    });

    expect(await repository.listWatched(CHAIN, NOW)).toHaveLength(0);
  });
});

describe("InMemoryDepositRepository", () => {
  test("records a transfer once, however often it is seen", async () => {
    const repository = new InMemoryDepositRepository();
    await repository.record([transferLog()], NOW);
    await repository.record([transferLog()], NOW);

    expect(
      await repository.listByAddress(CHAIN, deriver.derive(1)),
    ).toHaveLength(1);
  });

  test("treats a different log index in the same transaction as a separate deposit", async () => {
    const repository = new InMemoryDepositRepository();
    await repository.record([transferLog(), transferLog({ logIndex: 1 })], NOW);

    expect(
      await repository.listByAddress(CHAIN, deriver.derive(1)),
    ).toHaveLength(2);
  });

  test("counts only CONFIRMED deposits in the total", async () => {
    const repository = new InMemoryDepositRepository();
    const [first, second] = await repository.record(
      [transferLog(), transferLog({ txHash: "0xtx2", amount: 500_000n })],
      NOW,
    );
    if (first === undefined || second === undefined)
      throw new Error("expected two deposits");

    await repository.updateStatuses([
      { id: first.id, status: "CONFIRMED", at: NOW },
    ]);

    const total = await repository.confirmedTotal(
      CHAIN,
      deriver.derive(1),
      "USDC",
    );
    expect(total.amount).toBe(1_000_000n);
  });

  test("an orphaned deposit stops counting", async () => {
    const repository = new InMemoryDepositRepository();
    const [deposit] = await repository.record([transferLog()], NOW);
    if (deposit === undefined) throw new Error("expected a deposit");

    await repository.updateStatuses([
      { id: deposit.id, status: "CONFIRMED", at: NOW },
    ]);
    await repository.updateStatuses([
      { id: deposit.id, status: "ORPHANED", at: NOW },
    ]);

    const total = await repository.confirmedTotal(
      CHAIN,
      deriver.derive(1),
      "USDC",
    );
    expect(total.amount).toBe(0n);
  });

  test("keeps both timestamps when a confirmed deposit is orphaned", async () => {
    const repository = new InMemoryDepositRepository();
    const [deposit] = await repository.record([transferLog()], NOW);
    if (deposit === undefined) throw new Error("expected a deposit");

    await repository.updateStatuses([
      { id: deposit.id, status: "CONFIRMED", at: NOW },
    ]);
    await repository.updateStatuses([
      { id: deposit.id, status: "ORPHANED", at: NOW },
    ]);

    const [stored] = await repository.listByAddress(CHAIN, deriver.derive(1));
    expect(stored?.confirmedAt).toBeDefined();
    expect(stored?.orphanedAt).toBeDefined();
  });
});

describe("InMemoryWatcherCursorRepository", () => {
  test("returns null before anything is scanned", async () => {
    const repository = new InMemoryWatcherCursorRepository();
    expect(await repository.get(CHAIN, "USDC")).toBeNull();
  });

  test("round-trips a cursor per chain and asset", async () => {
    const repository = new InMemoryWatcherCursorRepository();
    await repository.set(CHAIN, "USDC", 42n);

    expect(await repository.get(CHAIN, "USDC")).toBe(42n);
    expect(await repository.get(CHAIN, "USDT")).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test packages/db/test/memory-chain.test.ts`
Expected: FAIL — `Cannot find module '../src/memory/chain.ts'`.

- [ ] **Step 4: Implement the in-memory repositories**

`packages/db/src/memory/chain.ts`:

```ts
/**
 * In-memory chain repositories.
 *
 * They enforce the same invariants as the Postgres adapters — one address per
 * clearing transaction, one deposit row per `(chain, txHash, logIndex)` — so a
 * test that passes here is not passing for the wrong reason.
 */

import type {
  AllocateDepositAddress,
  ChainId,
  Deposit,
  DepositAddress,
  DepositAddressRepository,
  DepositRepository,
  DepositStatusUpdate,
  TransferLog,
  WatchedAddress,
  WatcherCursorRepository,
} from "@mayarin/chain";
import { type AssetCode, generateId, type Money, zero } from "@mayarin/shared";

/** What the address repository needs to know about a clearing transaction. */
export interface WatchedTransactionState {
  readonly fundable: boolean;
  readonly requiredAmount: Money;
  /** Set once the transaction is terminal. */
  readonly terminalAt?: Date;
}

export type ResolveWatchedTransaction = (
  clearingTransactionId: string,
) => WatchedTransactionState | undefined;

export class InMemoryDepositAddressRepository implements DepositAddressRepository {
  readonly #byTransaction = new Map<string, DepositAddress>();
  readonly #resolve: ResolveWatchedTransaction;
  #nextIndex = 0;

  constructor(resolve: ResolveWatchedTransaction = () => undefined) {
    this.#resolve = resolve;
  }

  async allocate(input: AllocateDepositAddress): Promise<DepositAddress> {
    const existing = this.#byTransaction.get(input.clearingTransactionId);
    if (existing !== undefined) return existing;

    const derivationIndex = this.#nextIndex;
    this.#nextIndex += 1;

    const address: DepositAddress = {
      id: generateId("dad", input.now.getTime()),
      clearingTransactionId: input.clearingTransactionId,
      derivationIndex,
      chain: input.chain,
      asset: input.asset,
      address: input.deriver.derive(derivationIndex).toLowerCase(),
      createdAt: new Date(input.now),
    };

    this.#byTransaction.set(input.clearingTransactionId, address);
    return address;
  }

  async findByClearingTransactionId(
    clearingTransactionId: string,
  ): Promise<DepositAddress | null> {
    return this.#byTransaction.get(clearingTransactionId) ?? null;
  }

  async listWatched(
    chain: ChainId,
    retainTerminalSince: Date,
  ): Promise<WatchedAddress[]> {
    const watched: WatchedAddress[] = [];

    for (const address of this.#byTransaction.values()) {
      if (address.chain !== chain) continue;

      const state = this.#resolve(address.clearingTransactionId);
      if (state === undefined) continue;
      // Terminal and older than the retention cutoff: stop scanning for it.
      if (
        state.terminalAt !== undefined &&
        state.terminalAt < retainTerminalSince
      )
        continue;

      watched.push({
        clearingTransactionId: address.clearingTransactionId,
        chain: address.chain,
        asset: address.asset,
        address: address.address,
        requiredAmount: state.requiredAmount,
        fundable: state.fundable,
      });
    }

    return watched;
  }
}

export class InMemoryDepositRepository implements DepositRepository {
  readonly #byKey = new Map<string, Deposit>();

  async record(
    transfers: readonly TransferLog[],
    now: Date,
  ): Promise<Deposit[]> {
    const recorded: Deposit[] = [];

    for (const transfer of transfers) {
      const key = depositKey(
        transfer.chain,
        transfer.txHash,
        transfer.logIndex,
      );
      const existing = this.#byKey.get(key);
      if (existing !== undefined) {
        recorded.push(existing);
        continue;
      }

      const deposit: Deposit = {
        id: generateId("dep", now.getTime()),
        chain: transfer.chain,
        txHash: transfer.txHash,
        logIndex: transfer.logIndex,
        address: transfer.to.toLowerCase(),
        amount: { amount: transfer.amount, asset: transfer.asset },
        blockNumber: transfer.blockNumber,
        blockHash: transfer.blockHash,
        status: "PENDING",
        firstSeenAt: new Date(now),
      };

      this.#byKey.set(key, deposit);
      recorded.push(deposit);
    }

    return recorded;
  }

  async listProbable(chain: ChainId, limit: number): Promise<Deposit[]> {
    return [...this.#byKey.values()]
      .filter(
        (deposit) => deposit.chain === chain && deposit.status !== "ORPHANED",
      )
      .sort((a, b) =>
        a.blockNumber < b.blockNumber
          ? -1
          : a.blockNumber > b.blockNumber
            ? 1
            : 0,
      )
      .slice(0, limit);
  }

  async updateStatuses(updates: readonly DepositStatusUpdate[]): Promise<void> {
    for (const update of updates) {
      for (const [key, deposit] of this.#byKey) {
        if (deposit.id !== update.id) continue;
        this.#byKey.set(key, applyStatus(deposit, update));
        break;
      }
    }
  }

  async listByAddress(chain: ChainId, address: string): Promise<Deposit[]> {
    const wanted = address.toLowerCase();
    return [...this.#byKey.values()].filter(
      (deposit) => deposit.chain === chain && deposit.address === wanted,
    );
  }

  async confirmedTotal(
    chain: ChainId,
    address: string,
    asset: AssetCode,
  ): Promise<Money> {
    const deposits = await this.listByAddress(chain, address);
    return deposits
      .filter(
        (deposit) =>
          deposit.status === "CONFIRMED" && deposit.amount.asset === asset,
      )
      .reduce<Money>(
        (total, deposit) => ({
          amount: total.amount + deposit.amount.amount,
          asset,
        }),
        zero(asset),
      );
  }
}

export class InMemoryWatcherCursorRepository implements WatcherCursorRepository {
  readonly #cursors = new Map<string, bigint>();

  async get(chain: ChainId, asset: AssetCode): Promise<bigint | null> {
    return this.#cursors.get(`${chain}/${asset}`) ?? null;
  }

  async set(chain: ChainId, asset: AssetCode, block: bigint): Promise<void> {
    this.#cursors.set(`${chain}/${asset}`, block);
  }
}

function depositKey(chain: ChainId, txHash: string, logIndex: number): string {
  return `${chain}:${txHash}:${logIndex}`;
}

/**
 * Status timestamps accumulate rather than replace: a deposit that was
 * confirmed and then orphaned keeps both, and that pair is how an
 * orphaned-after-confirmed deposit is identified.
 */
function applyStatus(deposit: Deposit, update: DepositStatusUpdate): Deposit {
  return {
    ...deposit,
    status: update.status,
    ...(update.status === "CONFIRMED"
      ? { confirmedAt: new Date(update.at) }
      : {}),
    ...(update.status === "ORPHANED"
      ? { orphanedAt: new Date(update.at) }
      : {}),
  };
}
```

- [ ] **Step 5: Export from the memory barrel**

`packages/db/src/memory/index.ts` gains, keeping the list alphabetical:

```ts
export * from "./chain.ts";
```

- [ ] **Step 6: Run the tests and typecheck**

Run: `bun test packages/db/test/memory-chain.test.ts && bun run typecheck`
Expected: 11 tests pass, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add packages/db package.json bun.lock
git commit -m "feat(db): add in-memory chain repositories

Status timestamps accumulate rather than replace: a deposit holding both
confirmedAt and orphanedAt is one that was counted and then reorged away, which
is the condition that needs a human rather than an automatic reversal."
```

---

### Task 4: The wallet watcher

The heart of the subsystem. Every behavioural rule from the spec is tested here, against the fake chain and the in-memory repositories.

**Files:**

- Create: `packages/core/chain/src/events.ts`
- Create: `packages/core/chain/src/watcher.ts`
- Modify: `packages/core/chain/src/index.ts`
- Modify: `packages/core/chain/package.json` (dev dependencies)
- Test: `packages/core/chain/test/watcher.test.ts`

**Interfaces:**

- Consumes: everything from Tasks 1–3.
- Produces: `WalletWatcher`, `WalletWatcherOptions`, `TickResult { chain, asset, scannedFrom, scannedTo, recorded, confirmed, orphaned, funded }`, `WalletWatcher.tick(chain: ChainId, asset: AssetCode): Promise<TickResult>`, `CHAIN_DEPOSIT_ORPHANED` (the event type string `"chain.deposit.orphaned"`).

- [ ] **Step 1: Add the dev dependencies**

In `packages/core/chain/package.json` add:

```json
  "devDependencies": {
    "@mayarin/db": "workspace:*",
    "@mayarin/provider-mock-chain": "workspace:*"
  }
```

Run `bun install`.

- [ ] **Step 2: Write the failing watcher test**

`packages/core/chain/test/watcher.test.ts`:

```ts
import {
  InMemoryDepositAddressRepository,
  InMemoryDepositRepository,
  InMemoryWatcherCursorRepository,
  type WatchedTransactionState,
} from "@mayarin/db/memory";
import {
  FakeChainClient,
  FixedDepositAddressDeriver,
} from "@mayarin/provider-mock-chain";
import {
  type DomainEvent,
  FixedClock,
  InMemoryEventBus,
  money,
} from "@mayarin/shared";
import { beforeEach, describe, expect, test } from "bun:test";
import { WalletWatcher } from "../src/watcher.ts";

const CHAIN = "base-sepolia" as const;
const ASSET = "USDC" as const;
const NOW = "2026-01-01T00:00:00.000Z";
/** 3.21 USDC, six decimals. */
const REQUIRED = money(3_210_000n, ASSET);

function createHarness() {
  const clock = new FixedClock(NOW);
  const chain = new FakeChainClient();
  const deriver = new FixedDepositAddressDeriver();
  const funded: string[] = [];
  const published: DomainEvent[] = [];

  const events = new InMemoryEventBus();
  events.subscribe("*", (event) => {
    published.push(event);
  });

  const state = new Map<string, WatchedTransactionState>();
  const addresses = new InMemoryDepositAddressRepository((id) => state.get(id));
  const deposits = new InMemoryDepositRepository();
  const cursors = new InMemoryWatcherCursorRepository();

  const watcher = new WalletWatcher({
    client: chain,
    addresses,
    deposits,
    cursors,
    clock,
    events,
    sink: {
      fund: async (clearingTransactionId) => {
        funded.push(clearingTransactionId);
      },
    },
    policy: { depth: 6, reorgWatchWindow: 2 },
    blockRange: 2000,
    retentionSeconds: 86_400,
  });

  /** Registers a payment awaiting `REQUIRED` and returns its deposit address. */
  async function awaitingPayment(id = "clr_1"): Promise<string> {
    state.set(id, { fundable: true, requiredAmount: REQUIRED });
    const allocated = await addresses.allocate({
      clearingTransactionId: id,
      chain: CHAIN,
      asset: ASSET,
      deriver,
      now: clock.now(),
    });
    return allocated.address;
  }

  return {
    chain,
    watcher,
    addresses,
    deposits,
    cursors,
    funded,
    published,
    state,
    awaitingPayment,
  };
}

describe("WalletWatcher", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  test("a deposit below the confirmation depth does not fund", async () => {
    const address = await harness.awaitingPayment();
    harness.chain.transfer({
      asset: ASSET,
      to: address,
      amount: REQUIRED.amount,
    });
    harness.chain.mine(3);

    const result = await harness.watcher.tick(CHAIN, ASSET);

    expect(result.recorded).toBe(1);
    expect(result.funded).toBe(0);
    expect(harness.funded).toEqual([]);
  });

  test("a deposit reaching the depth funds the payment exactly once", async () => {
    const address = await harness.awaitingPayment();
    harness.chain.transfer({
      asset: ASSET,
      to: address,
      amount: REQUIRED.amount,
    });
    harness.chain.mine(6);

    await harness.watcher.tick(CHAIN, ASSET);
    expect(harness.funded).toEqual(["clr_1"]);

    harness.chain.mine(1);
    await harness.watcher.tick(CHAIN, ASSET);
    expect(harness.funded).toEqual(["clr_1"]);
  });

  test("two half-sends accumulate and fund on the second", async () => {
    const address = await harness.awaitingPayment();

    harness.chain.transfer({ asset: ASSET, to: address, amount: 2_000_000n });
    harness.chain.mine(6);
    await harness.watcher.tick(CHAIN, ASSET);
    expect(harness.funded).toEqual([]);

    harness.chain.transfer({ asset: ASSET, to: address, amount: 1_210_000n });
    harness.chain.mine(6);
    await harness.watcher.tick(CHAIN, ASSET);
    expect(harness.funded).toEqual(["clr_1"]);
  });

  test("an overpayment funds and the excess stays on the record", async () => {
    const address = await harness.awaitingPayment();
    harness.chain.transfer({ asset: ASSET, to: address, amount: 5_000_000n });
    harness.chain.mine(6);

    await harness.watcher.tick(CHAIN, ASSET);

    expect(harness.funded).toEqual(["clr_1"]);
    const total = await harness.deposits.confirmedTotal(CHAIN, address, ASSET);
    expect(total.amount).toBe(5_000_000n);
  });

  test("a reorg below the depth orphans the deposit and nothing was ever funded", async () => {
    const address = await harness.awaitingPayment();
    harness.chain.transfer({
      asset: ASSET,
      to: address,
      amount: REQUIRED.amount,
    });
    harness.chain.mine(3);
    await harness.watcher.tick(CHAIN, ASSET);

    harness.chain.reorg({ depth: 3 });
    await harness.watcher.tick(CHAIN, ASSET);

    const [deposit] = await harness.deposits.listByAddress(CHAIN, address);
    expect(deposit?.status).toBe("ORPHANED");
    expect(
      (await harness.deposits.confirmedTotal(CHAIN, address, ASSET)).amount,
    ).toBe(0n);
    expect(harness.funded).toEqual([]);
  });

  test("a reorg above the depth records the orphan and publishes an event", async () => {
    const address = await harness.awaitingPayment();
    harness.chain.transfer({
      asset: ASSET,
      to: address,
      amount: REQUIRED.amount,
    });
    harness.chain.mine(6);
    await harness.watcher.tick(CHAIN, ASSET);
    expect(harness.funded).toEqual(["clr_1"]);

    harness.chain.reorg({ depth: 6 });
    await harness.watcher.tick(CHAIN, ASSET);

    const [deposit] = await harness.deposits.listByAddress(CHAIN, address);
    expect(deposit?.status).toBe("ORPHANED");
    expect(deposit?.confirmedAt).toBeDefined();
    expect(deposit?.orphanedAt).toBeDefined();
    expect(harness.published.map((event) => event.type)).toContain(
      "chain.deposit.orphaned",
    );
  });

  test("the same log seen twice produces one deposit", async () => {
    const address = await harness.awaitingPayment();
    harness.chain.transfer({
      asset: ASSET,
      to: address,
      amount: REQUIRED.amount,
    });
    harness.chain.mine(1);

    await harness.watcher.tick(CHAIN, ASSET);
    await harness.cursors.set(CHAIN, ASSET, 0n); // simulate a crash before the cursor was written
    await harness.watcher.tick(CHAIN, ASSET);

    expect(await harness.deposits.listByAddress(CHAIN, address)).toHaveLength(
      1,
    );
  });

  test("a transfer arriving after the payment is terminal is recorded but does not fund", async () => {
    const address = await harness.awaitingPayment();
    harness.state.set("clr_1", {
      fundable: false,
      requiredAmount: REQUIRED,
      terminalAt: new Date(NOW),
    });

    harness.chain.transfer({
      asset: ASSET,
      to: address,
      amount: REQUIRED.amount,
    });
    harness.chain.mine(6);
    await harness.watcher.tick(CHAIN, ASSET);

    expect(await harness.deposits.listByAddress(CHAIN, address)).toHaveLength(
      1,
    );
    expect(harness.funded).toEqual([]);
  });

  test("the cursor advances even when nothing is being watched", async () => {
    harness.chain.mine(4);
    await harness.watcher.tick(CHAIN, ASSET);

    expect(await harness.cursors.get(CHAIN, ASSET)).toBe(4n);
  });

  test("a scan is capped at the configured block range", async () => {
    await harness.awaitingPayment();
    harness.chain.mine(5);

    const capped = new WalletWatcher({
      client: harness.chain,
      addresses: harness.addresses,
      deposits: harness.deposits,
      cursors: harness.cursors,
      clock: new FixedClock(NOW),
      sink: { fund: async () => {} },
      policy: { depth: 6, reorgWatchWindow: 2 },
      blockRange: 2,
      retentionSeconds: 86_400,
    });

    const result = await capped.tick(CHAIN, ASSET);
    expect(result.scannedFrom).toBe(1n);
    expect(result.scannedTo).toBe(2n);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test packages/core/chain/test/watcher.test.ts`
Expected: FAIL — `Cannot find module '../src/watcher.ts'`.

- [ ] **Step 4: Write the orphan event builder**

`packages/core/chain/src/events.ts`:

```ts
/**
 * Chain domain events.
 *
 * A deposit that was confirmed and then reorged away is published here rather
 * than appended to `clearing_events`: that table's `sequence` equals the
 * clearing transaction's `version`, and both count applied transitions, so an
 * entry with no transition behind it would break the invariant.
 */

import { type DomainEvent, generateId } from "@mayarin/shared";
import type { Deposit } from "./types.ts";

export const CHAIN_DEPOSIT_ORPHANED = "chain.deposit.orphaned";

export function depositOrphanedEvent(
  deposit: Deposit,
  clearingTransactionId: string,
  now: Date,
): DomainEvent {
  return {
    id: generateId("dep", now.getTime()),
    type: CHAIN_DEPOSIT_ORPHANED,
    aggregateId: clearingTransactionId,
    occurredAt: new Date(now),
    payload: {
      depositId: deposit.id,
      chain: deposit.chain,
      txHash: deposit.txHash,
      logIndex: deposit.logIndex,
      address: deposit.address,
      amount: deposit.amount.amount.toString(),
      asset: deposit.amount.asset,
      blockNumber: deposit.blockNumber.toString(),
      /** True when value that had already been counted was lost. */
      wasConfirmed: deposit.confirmedAt !== undefined,
    },
  };
}
```

- [ ] **Step 5: Implement the watcher**

`packages/core/chain/src/watcher.ts`:

```ts
/**
 * Wallet watcher.
 *
 * One `tick()` is one complete pass over one `(chain, asset)` pair: scan a
 * bounded block range for transfers to watched addresses, reclassify what is
 * already known against the current head, and fund any payment whose confirmed
 * deposits now cover what it is owed.
 *
 * Ordering matters in one place: the cursor is written last. A crash mid-pass
 * therefore re-scans its range rather than skipping it, and re-scanning is free
 * because deposits are keyed by `(chain, txHash, logIndex)`.
 *
 * Funding needs no guard of its own — `recordAssetReceived` returns early for a
 * transaction that is no longer PAYMENT_PENDING, so a second tick over a funded
 * address does nothing.
 */

import {
  type AssetCode,
  type Clock,
  type EventPublisher,
  type Money,
  noopEventPublisher,
} from "@mayarin/shared";
import type { AssetReceiptSink, ChainClient } from "./client.ts";
import { depositOrphanedEvent } from "./events.ts";
import {
  classifyDeposit,
  type ConfirmationPolicy,
  confirmationsOf,
  isWithinReorgWatch,
} from "./policy.ts";
import type {
  DepositAddressRepository,
  DepositRepository,
  DepositStatusUpdate,
  WatcherCursorRepository,
} from "./repository.ts";
import type { ChainId, Deposit, WatchedAddress } from "./types.ts";

export interface WalletWatcherOptions {
  readonly client: ChainClient;
  readonly addresses: DepositAddressRepository;
  readonly deposits: DepositRepository;
  readonly cursors: WatcherCursorRepository;
  readonly sink: AssetReceiptSink;
  readonly clock: Clock;
  readonly policy: ConfirmationPolicy;
  /** Maximum blocks scanned in one pass. Keeps `eth_getLogs` inside provider limits. */
  readonly blockRange: number;
  /** How long a terminal payment's address stays in the watch set. */
  readonly retentionSeconds: number;
  readonly events?: EventPublisher;
  /** Block to start from when a chain has no cursor yet. */
  readonly startBlocks?: Readonly<Partial<Record<ChainId, bigint>>>;
  /** Cap on deposits re-probed per pass. */
  readonly probeLimit?: number;
}

export interface TickResult {
  readonly chain: ChainId;
  readonly asset: AssetCode;
  readonly scannedFrom: bigint;
  readonly scannedTo: bigint;
  readonly recorded: number;
  readonly confirmed: number;
  readonly orphaned: number;
  readonly funded: number;
}

export class WalletWatcher {
  readonly #client: ChainClient;
  readonly #addresses: DepositAddressRepository;
  readonly #deposits: DepositRepository;
  readonly #cursors: WatcherCursorRepository;
  readonly #sink: AssetReceiptSink;
  readonly #clock: Clock;
  readonly #policy: ConfirmationPolicy;
  readonly #blockRange: bigint;
  readonly #retentionSeconds: number;
  readonly #events: EventPublisher;
  readonly #startBlocks: Readonly<Partial<Record<ChainId, bigint>>>;
  readonly #probeLimit: number;

  constructor(options: WalletWatcherOptions) {
    this.#client = options.client;
    this.#addresses = options.addresses;
    this.#deposits = options.deposits;
    this.#cursors = options.cursors;
    this.#sink = options.sink;
    this.#clock = options.clock;
    this.#policy = options.policy;
    this.#blockRange = BigInt(options.blockRange);
    this.#retentionSeconds = options.retentionSeconds;
    this.#events = options.events ?? noopEventPublisher;
    this.#startBlocks = options.startBlocks ?? {};
    this.#probeLimit = options.probeLimit ?? 500;
  }

  async tick(chain: ChainId, asset: AssetCode): Promise<TickResult> {
    const now = this.#clock.now();
    const head = await this.#client.head(chain);

    const cursor = await this.#cursors.get(chain, asset);
    const start = cursor ?? this.#startBlocks[chain] ?? 0n;
    const from = start + 1n;
    const to = min(head.number, start + this.#blockRange);
    // A reorg replaces blocks without advancing the head, so there can be
    // nothing new to scan and still be everything to reclassify. Only the scan
    // is skipped here — returning early would make the watcher blind to exactly
    // the case it exists to catch.
    const hasNewBlocks = from <= to;

    const watched = await this.#addresses.listWatched(
      chain,
      this.#retentionCutoff(now),
    );

    const recorded = hasNewBlocks
      ? await this.#scan(chain, asset, from, to, watched, now)
      : 0;
    const { confirmed, orphaned } = await this.#reclassify(
      chain,
      head.number,
      watched,
      now,
    );
    const funded = await this.#fund(chain, asset, watched);

    // Written last: a crash before this line re-scans the same range, which the
    // deposit key makes harmless.
    if (hasNewBlocks) await this.#cursors.set(chain, asset, to);

    return {
      chain,
      asset,
      scannedFrom: from,
      scannedTo: hasNewBlocks ? to : start,
      recorded,
      confirmed,
      orphaned,
      funded,
    };
  }

  async #scan(
    chain: ChainId,
    asset: AssetCode,
    fromBlock: bigint,
    toBlock: bigint,
    watched: readonly WatchedAddress[],
    now: Date,
  ): Promise<number> {
    const addresses = watched
      .filter((entry) => entry.asset === asset)
      .map((entry) => entry.address);
    if (addresses.length === 0) return 0;

    const logs = await this.#client.transfers({
      chain,
      asset,
      fromBlock,
      toBlock,
      addresses,
    });
    if (logs.length === 0) return 0;

    await this.#deposits.record(logs, now);
    return logs.length;
  }

  /** Re-reads canonical hashes and moves deposits between statuses. */
  async #reclassify(
    chain: ChainId,
    headNumber: bigint,
    watched: readonly WatchedAddress[],
    now: Date,
  ): Promise<{ confirmed: number; orphaned: number }> {
    const probable = await this.#deposits.listProbable(chain, this.#probeLimit);
    const inWatch = probable.filter((deposit) =>
      isWithinReorgWatch(
        confirmationsOf(deposit.blockNumber, headNumber),
        this.#policy,
      ),
    );
    if (inWatch.length === 0) return { confirmed: 0, orphaned: 0 };

    // One probe per distinct height: N deposits in one block cost one call.
    const hashes = new Map<bigint, string | null>();
    for (const deposit of inWatch) {
      if (hashes.has(deposit.blockNumber)) continue;
      hashes.set(
        deposit.blockNumber,
        await this.#client.blockHash(chain, deposit.blockNumber),
      );
    }

    const updates: DepositStatusUpdate[] = [];
    const orphans: Deposit[] = [];

    for (const deposit of inWatch) {
      const next = classifyDeposit({
        current: deposit.status,
        blockNumber: deposit.blockNumber,
        blockHash: deposit.blockHash,
        headNumber,
        canonicalHash: hashes.get(deposit.blockNumber) ?? undefined,
        policy: this.#policy,
      });

      if (next === deposit.status) continue;
      updates.push({ id: deposit.id, status: next, at: now });
      if (next === "ORPHANED") orphans.push(deposit);
    }

    if (updates.length > 0) await this.#deposits.updateStatuses(updates);

    await this.#publishOrphans(orphans, watched, now);

    return {
      confirmed: updates.filter((update) => update.status === "CONFIRMED")
        .length,
      orphaned: updates.filter((update) => update.status === "ORPHANED").length,
    };
  }

  async #publishOrphans(
    orphans: readonly Deposit[],
    watched: readonly WatchedAddress[],
    now: Date,
  ): Promise<void> {
    if (orphans.length === 0) return;

    const owners = new Map(
      watched.map((entry) => [entry.address, entry.clearingTransactionId]),
    );
    const events = orphans.flatMap((deposit) => {
      const owner = owners.get(deposit.address);
      return owner === undefined
        ? []
        : [depositOrphanedEvent(deposit, owner, now)];
    });

    if (events.length > 0) await this.#events.publish(events);
  }

  async #fund(
    chain: ChainId,
    asset: AssetCode,
    watched: readonly WatchedAddress[],
  ): Promise<number> {
    let funded = 0;

    for (const entry of watched) {
      if (!entry.fundable || entry.asset !== asset) continue;

      const total = await this.#deposits.confirmedTotal(
        chain,
        entry.address,
        asset,
      );
      if (!covers(total, entry.requiredAmount)) continue;

      await this.#sink.fund(entry.clearingTransactionId);
      funded += 1;
    }

    return funded;
  }

  #retentionCutoff(now: Date): Date {
    return new Date(now.getTime() - this.#retentionSeconds * 1_000);
  }
}

/** Accumulate-and-confirm: the total must reach what is owed, not equal it. */
function covers(total: Money, required: Money): boolean {
  return total.asset === required.asset && total.amount >= required.amount;
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
```

- [ ] **Step 6: Extend the barrel**

`packages/core/chain/src/index.ts`:

```ts
export * from "./client.ts";
export * from "./events.ts";
export * from "./policy.ts";
export * from "./repository.ts";
export * from "./types.ts";
export * from "./watcher.ts";
```

- [ ] **Step 7: Run the tests and typecheck**

Run: `bun test packages/core/chain && bun run typecheck`
Expected: 20 tests pass, typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add packages/core/chain package.json bun.lock
git commit -m "feat(chain): add the wallet watcher

The cursor is written last, so a crash mid-pass re-scans rather than skips —
harmless because deposits are keyed by (chain, txHash, logIndex). Accumulation
is not a special case: two half-sends, a fee-deducted withdrawal and an exact
payment are all rows summing to a total."
```

---

### Task 5: The payer's leg on the payment intent

**Files:**

- Modify: `packages/core/payment-intent/src/types.ts`
- Modify: `packages/core/payment-intent/src/intent.ts`
- Modify: `packages/core/payment-intent/src/service.ts`
- Modify: `packages/core/payment-intent/package.json`
- Test: `packages/core/payment-intent/test/intent.test.ts` (append)

**Interfaces:**

- Consumes: `ChainId` from `@mayarin/chain`.
- Produces: `PaymentRail { asset: AssetCode; chain: ChainId }`; `PaymentIntent.payment?: PaymentRail`; `CreatePaymentIntentInput.payment?`; `CreatePaymentIntentCommand.payment?`.

- [ ] **Step 1: Add the dependency**

In `packages/core/payment-intent/package.json`, add to `dependencies`:

```json
    "@mayarin/chain": "workspace:*",
```

Run `bun install`.

- [ ] **Step 2: Write the failing test**

Append to `packages/core/payment-intent/test/intent.test.ts`:

```ts
describe("payment rail", () => {
  test("an intent without a rail has no payment leg", () => {
    const intent = createPaymentIntent({
      merchant: {
        id: "M1",
        name: "Warung",
        city: "Jakarta",
        countryCode: "ID",
      },
      amount: money(5_000_000n, "IDR"),
      settlementAsset: "IDRX",
      provider: "mock",
      source: { type: "manual" },
      ttlSeconds: 900,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(intent.payment).toBeUndefined();
  });

  test("carries the payer's asset and chain through creation", () => {
    const intent = createPaymentIntent({
      merchant: {
        id: "M1",
        name: "Warung",
        city: "Jakarta",
        countryCode: "ID",
      },
      amount: money(5_000_000n, "IDR"),
      settlementAsset: "IDRX",
      provider: "mock",
      source: { type: "manual" },
      payment: { asset: "USDC", chain: "base-sepolia" },
      ttlSeconds: 900,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(intent.payment).toEqual({ asset: "USDC", chain: "base-sepolia" });
  });
});
```

Add `createPaymentIntent` and `money` to the file's existing imports if they are not already there.

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test packages/core/payment-intent -t "payment rail"`
Expected: FAIL — `payment` is not a known property, or `intent.payment` is `undefined` in the second test.

- [ ] **Step 4: Add the type**

In `packages/core/payment-intent/src/types.ts`, add the import and the interface above `PaymentIntent`:

```ts
import type { ChainId } from "@mayarin/chain";

/**
 * The rail the payer intends to pay on.
 *
 * Distinct from both `amount.asset` (what the merchant quoted) and
 * `settlementAsset` (what the merchant is paid): a payer settling an IDR bill
 * with USDC on Base involves all three.
 */
export interface PaymentRail {
  readonly asset: AssetCode;
  readonly chain: ChainId;
}
```

And inside `PaymentIntent`, after `readonly provider: string;`:

```ts
  /** Absent for a fiat-only intent, which is every Phase 1 intent. */
  readonly payment?: PaymentRail;
```

- [ ] **Step 5: Carry it through creation**

In `packages/core/payment-intent/src/intent.ts`, add `PaymentRail` to the type import from `./types.ts`, add to `CreatePaymentIntentInput` after `readonly provider: string;`:

```ts
  readonly payment?: PaymentRail;
```

and in the returned object of `createPaymentIntent`, after `provider: input.provider,`:

```ts
    ...(input.payment === undefined ? {} : { payment: input.payment }),
```

- [ ] **Step 6: Accept it on the command**

In `packages/core/payment-intent/src/service.ts`, add `PaymentRail` to the type import from `./types.ts`, add to `CreatePaymentIntentCommand` after `readonly provider?: string;`:

```ts
  readonly payment?: PaymentRail;
```

In `create`, inside the `createPaymentIntent({ ... })` call, after the `provider,` line:

```ts
      ...(command.payment === undefined ? {} : { payment: command.payment }),
```

In `fingerprintOf`, add the rail to the canonical array after `command.provider,`:

```ts
    command.payment === undefined ? "none" : `${command.payment.chain}:${command.payment.asset}`,
```

The rail changes what the payer must send, so two requests differing only there are not the same payment and must not share an idempotency key.

- [ ] **Step 7: Run the tests and typecheck**

Run: `bun test packages/core/payment-intent && bun run typecheck`
Expected: all pass, including the pre-existing intent tests unchanged.

- [ ] **Step 8: Commit**

```bash
git add packages/core/payment-intent package.json bun.lock
git commit -m "feat(payment-intent): model the payer's asset and chain

A payer settling an IDR bill with USDC on Base involves three assets, not two.
The rail is part of the idempotency fingerprint: it changes what the payer must
send, so two requests differing only there are different payments."
```

---

### Task 6: The deposit leg and the second rate lock

**Files:**

- Modify: `packages/core/clearing/src/types.ts`
- Modify: `packages/core/clearing/src/engine.ts`
- Modify: `packages/core/clearing/package.json`
- Modify: `packages/core/clearing/test/harness.ts`
- Test: `packages/core/clearing/test/deposit.test.ts` (new file)

**Interfaces:**

- Consumes: `DepositAddressDeriver`, `DepositAddressRepository`, `ChainId` from `@mayarin/chain`; `PaymentRail` from `@mayarin/payment-intent`.
- Produces: `ClearingDeposit { asset, chain, address, amount, rate }`; `ClearingTransaction.deposit?: ClearingDeposit`; `ClearingEngineOptions.depositAddresses?: DepositAddressRepository`; `ClearingEngineOptions.depositDeriver?: DepositAddressDeriver`.

- [ ] **Step 1: Add the dependency**

In `packages/core/clearing/package.json`, add to `dependencies`:

```json
    "@mayarin/chain": "workspace:*",
```

and to `devDependencies`:

```json
    "@mayarin/provider-mock-chain": "workspace:*"
```

Run `bun install`.

- [ ] **Step 2: Write the failing test**

`packages/core/clearing/test/deposit.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createHarness } from "./harness.ts";

describe("deposit leg", () => {
  test("an intent with no rail locks the price exactly as before", async () => {
    const harness = createHarness();
    const intent = await harness.confirmedIntent();
    const transaction = await harness.engine.start(intent);

    expect(transaction.deposit).toBeUndefined();
    expect(transaction.state).toBe("SUCCESS");
  });

  test("an intent with a rail locks a deposit amount and an address", async () => {
    const harness = createHarness({
      autoConfirmAssetReceipt: false,
      // 50,000.00 IDR at 320 minor USDC units per whole IDR is 16.000000 USDC.
      rates: { "IDR/IDRX": 100n, "IDR/USDC": 320n },
    });
    const intent = await harness.confirmedIntent({
      payment: { asset: "USDC", chain: "base-sepolia" },
    });

    const transaction = await harness.engine.start(intent);

    expect(transaction.state).toBe("PAYMENT_PENDING");
    expect(transaction.deposit?.asset).toBe("USDC");
    expect(transaction.deposit?.chain).toBe("base-sepolia");
    expect(transaction.deposit?.amount.amount).toBe(16_000_000n);
    expect(transaction.deposit?.address).toBe("0x".concat("0".repeat(40)));
  });

  test("the settlement leg is unaffected by the deposit leg", async () => {
    const harness = createHarness({
      autoConfirmAssetReceipt: false,
      rates: { "IDR/IDRX": 100n, "IDR/USDC": 320n },
    });
    const intent = await harness.confirmedIntent({
      payment: { asset: "USDC", chain: "base-sepolia" },
    });

    const transaction = await harness.engine.start(intent);

    // 50,000.00 IDR -> 50,000.00 IDRX, 0.50% fee.
    expect(transaction.settlementAmount?.amount).toBe(5_000_000n);
    expect(transaction.fee?.amount).toBe(25_000n);
    expect(transaction.netAmount?.amount).toBe(4_975_000n);
  });

  test("replaying the price lock reuses the same address", async () => {
    const harness = createHarness({
      autoConfirmAssetReceipt: false,
      rates: { "IDR/IDRX": 100n, "IDR/USDC": 320n },
    });
    const intent = await harness.confirmedIntent({
      payment: { asset: "USDC", chain: "base-sepolia" },
    });

    const first = await harness.engine.start(intent);
    const again = await harness.engine.resume(first.id);

    expect(again.transaction.deposit?.address).toBe(
      first.deposit?.address ?? "",
    );
  });

  test("a rail with no configured rate fails the transaction", async () => {
    const harness = createHarness({
      autoConfirmAssetReceipt: false,
      rates: { "IDR/IDRX": 100n },
    });
    const intent = await harness.confirmedIntent({
      payment: { asset: "USDC", chain: "base-sepolia" },
    });

    const transaction = await harness.engine.start(intent);

    expect(transaction.state).toBe("FAILED");
    expect(transaction.failure?.code).toBe("CONFIGURATION_ERROR");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test packages/core/clearing/test/deposit.test.ts`
Expected: FAIL — `confirmedIntent` does not accept `payment`, and `transaction.deposit` does not exist.

- [ ] **Step 4: Add the deposit type**

In `packages/core/clearing/src/types.ts`, add the import and the interface above `ClearingTransaction`:

```ts
import type { ChainId } from "@mayarin/chain";

/**
 * The payer's leg, frozen at PRICE_LOCKED.
 *
 * Set together or not at all — an address without a locked amount would tell a
 * payer where to send money but not how much.
 */
export interface ClearingDeposit {
  readonly asset: AssetCode;
  readonly chain: ChainId;
  readonly address: string;
  /** What the payer must send, in the payment asset. */
  readonly amount: Money;
  /** Quote asset → payment asset. */
  readonly rate: LockedRate;
}
```

And inside `ClearingTransaction`, after the `netAmount` field:

```ts
  /** Set at PRICE_LOCKED when the intent names a payment rail. */
  readonly deposit?: ClearingDeposit;
```

- [ ] **Step 5: Wire the engine**

In `packages/core/clearing/src/engine.ts`:

Add to the imports:

```ts
import type {
  DepositAddressDeriver,
  DepositAddressRepository,
} from "@mayarin/chain";
```

Add to `ClearingEngineOptions`, after `readonly fees: FeePolicy;`:

```ts
  /**
   * Allocates a per-payment deposit address. Absent for a deployment with no
   * chain layer, in which case an intent naming a rail is rejected rather than
   * silently cleared without an address.
   */
  readonly depositAddresses?: DepositAddressRepository;
  readonly depositDeriver?: DepositAddressDeriver;
```

Add the private fields and constructor assignments alongside the existing ones:

```ts
  readonly #depositAddresses: DepositAddressRepository | undefined;
  readonly #depositDeriver: DepositAddressDeriver | undefined;
```

```ts
this.#depositAddresses = options.depositAddresses;
this.#depositDeriver = options.depositDeriver;
```

Replace the body of `#lockPrice` with:

```ts
  async #lockPrice(transaction: ClearingTransaction): Promise<ClearingTransaction> {
    const quote = await this.#rates.quote(
      transaction.sourceAmount.asset,
      transaction.settlementAsset,
      transaction.sourceAmount,
    );

    const now = this.#clock.now();
    const settlementAmount = convert(
      transaction.sourceAmount,
      transaction.settlementAsset,
      quote.minorUnitsPerWholeUnit,
    );
    const fee = this.#fees.feeFor(settlementAmount, {
      merchantId: transaction.merchant.id,
      provider: transaction.provider,
    });
    const netAmount = subtract(settlementAmount, fee);

    if (!isPositive(netAmount)) {
      throw new ValidationError(
        "Fee consumes the entire settlement amount; nothing would reach the merchant",
        {
          settlementAmount: settlementAmount.amount.toString(),
          fee: fee.amount.toString(),
          asset: settlementAmount.asset,
        },
      );
    }

    const deposit = await this.#lockDeposit(transaction, now);

    return this.#apply(
      transition(
        transaction,
        "PRICE_LOCKED",
        now,
        {
          rate: lockRate(quote, now),
          settlementAmount,
          fee,
          netAmount,
          ...(deposit === undefined ? {} : { deposit }),
        },
        {
          rate: quote.minorUnitsPerWholeUnit.toString(),
          rateSource: quote.source,
          settlementAmount: serializeMoney(settlementAmount),
          fee: serializeMoney(fee),
          netAmount: serializeMoney(netAmount),
          ...(deposit === undefined
            ? {}
            : {
                depositAddress: deposit.address,
                depositChain: deposit.chain,
                depositAmount: serializeMoney(deposit.amount),
              }),
        },
      ),
    );
  }

  /**
   * Quotes what the payer must send and allocates the address to send it to.
   *
   * Both are side effects that run before the state is persisted, matching the
   * engine's ordering rule: `allocate` is idempotent, so a crash between here
   * and the write means the resumed step re-derives the same address.
   */
  async #lockDeposit(
    transaction: ClearingTransaction,
    now: Date,
  ): Promise<ClearingDeposit | undefined> {
    const intent = await this.#intents.getById(transaction.paymentIntentId);
    const rail = intent.payment;
    if (rail === undefined) return undefined;

    const repository = this.#depositAddresses;
    const deriver = this.#depositDeriver;
    if (repository === undefined || deriver === undefined) {
      throw new ConfigurationError(
        `Payment intent ${intent.id} requests an on-chain rail but this deployment has no chain layer`,
        { paymentIntentId: intent.id, chain: rail.chain, asset: rail.asset },
      );
    }

    const quote = await this.#rates.quote(
      transaction.sourceAmount.asset,
      rail.asset,
      transaction.sourceAmount,
    );
    const amount = convert(transaction.sourceAmount, rail.asset, quote.minorUnitsPerWholeUnit);

    if (!isPositive(amount)) {
      throw new ValidationError("Deposit amount must be greater than zero", {
        amount: amount.amount.toString(),
        asset: amount.asset,
      });
    }

    const allocated = await repository.allocate({
      clearingTransactionId: transaction.id,
      chain: rail.chain,
      asset: rail.asset,
      deriver,
      now,
    });

    return {
      asset: rail.asset,
      chain: rail.chain,
      address: allocated.address,
      amount,
      rate: lockRate(quote, now),
    };
  }
```

Add `ConfigurationError` to the `@mayarin/shared` import list and `ClearingDeposit` to the type import from `./types.ts`.

- [ ] **Step 6: Extend the test harness**

In `packages/core/clearing/test/harness.ts`:

Add the imports:

```ts
import type { PaymentRail } from "@mayarin/payment-intent";
import { InMemoryDepositAddressRepository } from "@mayarin/db/memory";
import { FixedDepositAddressDeriver } from "@mayarin/provider-mock-chain";
```

Before the `engine` construction:

```ts
const depositAddresses = new InMemoryDepositAddressRepository();
const depositDeriver = new FixedDepositAddressDeriver();
```

Add to the `ClearingEngine` options, after `fees:`:

```ts
    depositAddresses,
    depositDeriver,
```

Change `confirmedIntent` to accept a rail:

```ts
  async function confirmedIntent(
    overrides: { idempotencyKey?: string; payment?: PaymentRail } = {},
  ) {
```

and add `depositAddresses` to the returned `repositories` object.

- [ ] **Step 7: Run the tests and typecheck**

Run: `bun test packages/core/clearing && bun run typecheck`
Expected: the 5 new tests pass and every pre-existing clearing test still passes untouched.

- [ ] **Step 8: Commit**

```bash
git add packages/core/clearing package.json bun.lock
git commit -m "feat(clearing): lock the payer's leg at PRICE_LOCKED

Two quotes off the same source amount: quote to settlement is unchanged Phase 1
behaviour, quote to payment gives what the payer must send. Deriving the deposit
amount from the settlement amount instead would stack two roundings and let the
figure shown to the payer drift from the figure locked.

Address allocation runs before the state is persisted and is idempotent, so a
crash in between re-derives the same address rather than issuing a second one."
```

---

### Task 7: Postgres schema, migration and Drizzle repositories

**Files:**

- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/src/repositories/chain.ts`
- Modify: `packages/db/src/repositories/clearing.ts`
- Modify: `packages/db/src/repositories/payment-intent.ts`
- Modify: `packages/db/src/index.ts`
- Create: `packages/db/migrations/*` (generated)
- Test: `packages/db/test/postgres.test.ts` (append)

**Interfaces:**

- Consumes: the ports from Task 2, the aggregate changes from Tasks 5–6.
- Produces: `DrizzleDepositAddressRepository`, `DrizzleDepositRepository`, `DrizzleWatcherCursorRepository`, and the `depositAddresses`, `chainDeposits`, `watcherCursors` tables.

- [ ] **Step 1: Add the tables and columns**

In `packages/db/src/schema.ts`, add to the `clearingTransactions` column list, after `netAmount`:

```ts
    depositAsset: text("deposit_asset"),
    depositChain: text("deposit_chain"),
    depositAddress: text("deposit_address"),
    depositAmount: minorUnits("deposit_amount"),
    depositRateMinorUnitsPerWholeUnit: minorUnits("deposit_rate_minor_units_per_whole_unit"),
    depositRateSource: text("deposit_rate_source"),
    depositRateLockedAt: timestamp("deposit_rate_locked_at", { withTimezone: true, mode: "date" }),
    depositRateExpiresAt: timestamp("deposit_rate_expires_at", { withTimezone: true, mode: "date" }),
```

The rate's `from` and `to` are not stored: they are `sourceAsset` and `depositAsset`, and a second copy is a second thing that can disagree.

Add to the `paymentIntents` column list, after `provider`:

```ts
    paymentAsset: text("payment_asset"),
    paymentChain: text("payment_chain"),
```

Then append the three new tables at the end of the file:

```ts
/**
 * Per-payment deposit addresses.
 *
 * `derivationIndex` is the address's identity: persisting it is what makes every
 * address re-derivable from the extended public key alone after a restore.
 */
export const depositAddresses = pgTable(
  "deposit_addresses",
  {
    id: text("id").primaryKey(),
    clearingTransactionId: text("clearing_transaction_id")
      .notNull()
      .references(() => clearingTransactions.id),
    derivationIndex: integer("derivation_index").notNull(),
    chain: text("chain").notNull(),
    asset: text("asset").notNull(),
    address: text("address").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("deposit_addresses_clearing_idx").on(
      table.clearingTransactionId,
    ),
    uniqueIndex("deposit_addresses_address_idx").on(table.chain, table.address),
    uniqueIndex("deposit_addresses_index_idx").on(table.derivationIndex),
  ],
);

/**
 * Observed inbound transfers.
 *
 * `(chain, tx_hash, log_index)` is the natural idempotency key: re-scanning a
 * block range after a crash cannot double-count. Nothing here touches a ledger
 * account — a deposit is an observation, not a posting.
 */
export const chainDeposits = pgTable(
  "chain_deposits",
  {
    id: text("id").primaryKey(),
    chain: text("chain").notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    address: text("address").notNull(),
    asset: text("asset").notNull(),
    amount: minorUnits("amount").notNull(),
    blockNumber: minorUnits("block_number").notNull(),
    blockHash: text("block_hash").notNull(),
    status: text("status").notNull(),
    firstSeenAt: timestamp("first_seen_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    confirmedAt: timestamp("confirmed_at", {
      withTimezone: true,
      mode: "date",
    }),
    orphanedAt: timestamp("orphaned_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    uniqueIndex("chain_deposits_log_idx").on(
      table.chain,
      table.txHash,
      table.logIndex,
    ),
    index("chain_deposits_address_idx").on(table.chain, table.address),
    index("chain_deposits_status_idx").on(
      table.chain,
      table.status,
      table.blockNumber,
    ),
  ],
);

/** How far the watcher has scanned, per chain and asset. */
export const watcherCursors = pgTable(
  "watcher_cursors",
  {
    chain: text("chain").notNull(),
    asset: text("asset").notNull(),
    lastBlock: minorUnits("last_block").notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.chain, table.asset] })],
);
```

Add `primaryKey` to the `drizzle-orm/pg-core` import list at the top of the file.

- [ ] **Step 2: Generate the migration**

Run: `bun run db:generate`
Expected: a new file under `packages/db/migrations/` creating three tables and adding ten columns. Read it and confirm every added column is nullable — an existing row must not need a default.

- [ ] **Step 3: Write the failing repository test**

Append to `packages/db/test/postgres.test.ts`, inside the existing guarded describe block (follow the file's existing skip-unless-`DATABASE_URL` pattern):

```ts
test("allocates one deposit address per clearing transaction", async () => {
  const repository = new DrizzleDepositAddressRepository(db);
  const deriver = new FixedDepositAddressDeriver();
  const transactionId = await seedClearingTransaction();

  const first = await repository.allocate({
    clearingTransactionId: transactionId,
    chain: "base-sepolia",
    asset: "USDC",
    deriver,
    now: new Date(),
  });
  const again = await repository.allocate({
    clearingTransactionId: transactionId,
    chain: "base-sepolia",
    asset: "USDC",
    deriver,
    now: new Date(),
  });

  expect(again.id).toBe(first.id);
  expect(again.address).toBe(first.address);
});

test("records a transfer once however often it is seen", async () => {
  const repository = new DrizzleDepositRepository(db);
  const log = {
    chain: "base-sepolia",
    asset: "USDC",
    txHash: `0x${Date.now().toString(16)}`,
    logIndex: 0,
    blockNumber: 100n,
    blockHash: "0xb100",
    from: "0xfrom",
    to: "0xdeadbeef",
    amount: 1_000_000n,
  } as const;

  await repository.record([log], new Date());
  await repository.record([log], new Date());

  const stored = await repository.listByAddress("base-sepolia", "0xdeadbeef");
  expect(stored).toHaveLength(1);
});

test("round-trips a watcher cursor", async () => {
  const repository = new DrizzleWatcherCursorRepository(db);
  await repository.set("base-sepolia", "USDC", 512n);
  await repository.set("base-sepolia", "USDC", 900n);

  expect(await repository.get("base-sepolia", "USDC")).toBe(900n);
});
```

`seedClearingTransaction` inserts a payment intent and a clearing transaction using the existing helpers in that file and returns the clearing transaction id; write it beside the file's existing seed helpers, following their style.

- [ ] **Step 4: Run the test to verify it fails**

```bash
bun run db:up
export $(grep -E '^DATABASE_URL' .env) && bun run --cwd packages/db migrate
bun test packages/db
```

Expected: FAIL — `DrizzleDepositAddressRepository` is not exported.

- [ ] **Step 5: Implement the Drizzle repositories**

`packages/db/src/repositories/chain.ts`:

```ts
/**
 * Drizzle chain repositories.
 *
 * Two uniqueness guarantees are the database's, not the application's: one
 * address per clearing transaction, and one deposit row per
 * `(chain, tx_hash, log_index)`. Both are expressed as `ON CONFLICT DO NOTHING`
 * followed by a read, so a concurrent writer loses the race harmlessly rather
 * than raising.
 */

import type {
  AllocateDepositAddress,
  ChainId,
  Deposit,
  DepositAddress,
  DepositAddressRepository,
  DepositRepository,
  DepositStatus,
  DepositStatusUpdate,
  TransferLog,
  WatchedAddress,
  WatcherCursorRepository,
} from "@mayarin/chain";
import { isChainId } from "@mayarin/chain";
import {
  type AssetCode,
  ConflictError,
  generateId,
  type Money,
  ValidationError,
  zero,
} from "@mayarin/shared";
import { and, asc, eq, inArray, lt, or, sql } from "drizzle-orm";
import type { Database } from "../client.ts";
import { toAsset, toMoney } from "../mapping.ts";
import {
  chainDeposits,
  clearingTransactions,
  depositAddresses,
  watcherCursors,
} from "../schema.ts";

const TERMINAL_STATES = ["SUCCESS", "FAILED"] as const;

export class DrizzleDepositAddressRepository implements DepositAddressRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async allocate(input: AllocateDepositAddress): Promise<DepositAddress> {
    const existing = await this.findByClearingTransactionId(
      input.clearingTransactionId,
    );
    if (existing !== null) return existing;

    // The sequence is the allocator: concurrent callers get distinct indices
    // without a lock, and a rolled-back transaction merely skips one.
    const [row] = await this.#db.execute<{ nextval: string }>(
      sql`select nextval('deposit_address_index_seq') as nextval`,
    );
    if (row === undefined) {
      throw new ConflictError("Could not allocate a deposit derivation index", {
        clearingTransactionId: input.clearingTransactionId,
      });
    }

    const derivationIndex = Number(row.nextval);
    const address: DepositAddress = {
      id: generateId("dad", input.now.getTime()),
      clearingTransactionId: input.clearingTransactionId,
      derivationIndex,
      chain: input.chain,
      asset: input.asset,
      address: input.deriver.derive(derivationIndex).toLowerCase(),
      createdAt: new Date(input.now),
    };

    await this.#db
      .insert(depositAddresses)
      .values({
        id: address.id,
        clearingTransactionId: address.clearingTransactionId,
        derivationIndex: address.derivationIndex,
        chain: address.chain,
        asset: address.asset,
        address: address.address,
        createdAt: address.createdAt,
      })
      .onConflictDoNothing();

    // A concurrent allocation for the same transaction wins; read back rather
    // than assume ours landed.
    const stored = await this.findByClearingTransactionId(
      input.clearingTransactionId,
    );
    if (stored === null) {
      throw new ConflictError("Deposit address allocation did not persist", {
        clearingTransactionId: input.clearingTransactionId,
      });
    }
    return stored;
  }

  async findByClearingTransactionId(
    clearingTransactionId: string,
  ): Promise<DepositAddress | null> {
    const [row] = await this.#db
      .select()
      .from(depositAddresses)
      .where(eq(depositAddresses.clearingTransactionId, clearingTransactionId))
      .limit(1);

    return row === undefined ? null : toDepositAddress(row);
  }

  async listWatched(
    chain: ChainId,
    retainTerminalSince: Date,
  ): Promise<WatchedAddress[]> {
    const rows = await this.#db
      .select({
        clearingTransactionId: depositAddresses.clearingTransactionId,
        chain: depositAddresses.chain,
        asset: depositAddresses.asset,
        address: depositAddresses.address,
        depositAmount: clearingTransactions.depositAmount,
        depositAsset: clearingTransactions.depositAsset,
        state: clearingTransactions.state,
      })
      .from(depositAddresses)
      .innerJoin(
        clearingTransactions,
        eq(depositAddresses.clearingTransactionId, clearingTransactions.id),
      )
      .where(
        and(
          eq(depositAddresses.chain, chain),
          or(
            // Still in flight, or terminal but inside the retention window.
            sql`${clearingTransactions.state} not in ${TERMINAL_STATES}`,
            sql`${clearingTransactions.updatedAt} >= ${retainTerminalSince}`,
          ),
        ),
      );

    return rows.flatMap((row) => {
      if (row.depositAmount === null || row.depositAsset === null) return [];
      if (!isChainId(row.chain)) return [];
      return [
        {
          clearingTransactionId: row.clearingTransactionId,
          chain: row.chain,
          asset: toAsset(row.asset),
          address: row.address,
          requiredAmount: toMoney(row.depositAmount, row.depositAsset),
          fundable: !(TERMINAL_STATES as readonly string[]).includes(row.state),
        },
      ];
    });
  }
}

export class DrizzleDepositRepository implements DepositRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async record(
    transfers: readonly TransferLog[],
    now: Date,
  ): Promise<Deposit[]> {
    if (transfers.length === 0) return [];

    await this.#db
      .insert(chainDeposits)
      .values(
        transfers.map((transfer) => ({
          id: generateId("dep", now.getTime()),
          chain: transfer.chain,
          txHash: transfer.txHash,
          logIndex: transfer.logIndex,
          address: transfer.to.toLowerCase(),
          asset: transfer.asset,
          amount: transfer.amount.toString(),
          blockNumber: transfer.blockNumber.toString(),
          blockHash: transfer.blockHash,
          status: "PENDING" satisfies DepositStatus,
          firstSeenAt: new Date(now),
        })),
      )
      .onConflictDoNothing();

    const rows = await this.#db
      .select()
      .from(chainDeposits)
      .where(
        inArray(
          chainDeposits.txHash,
          transfers.map((transfer) => transfer.txHash),
        ),
      );

    return rows.map(toDeposit);
  }

  async listProbable(chain: ChainId, limit: number): Promise<Deposit[]> {
    const rows = await this.#db
      .select()
      .from(chainDeposits)
      .where(
        and(
          eq(chainDeposits.chain, chain),
          sql`${chainDeposits.status} <> 'ORPHANED'`,
        ),
      )
      .orderBy(asc(chainDeposits.blockNumber))
      .limit(limit);

    return rows.map(toDeposit);
  }

  async updateStatuses(updates: readonly DepositStatusUpdate[]): Promise<void> {
    for (const update of updates) {
      await this.#db
        .update(chainDeposits)
        .set({
          status: update.status,
          ...(update.status === "CONFIRMED"
            ? { confirmedAt: new Date(update.at) }
            : {}),
          ...(update.status === "ORPHANED"
            ? { orphanedAt: new Date(update.at) }
            : {}),
        })
        .where(eq(chainDeposits.id, update.id));
    }
  }

  async listByAddress(chain: ChainId, address: string): Promise<Deposit[]> {
    const rows = await this.#db
      .select()
      .from(chainDeposits)
      .where(
        and(
          eq(chainDeposits.chain, chain),
          eq(chainDeposits.address, address.toLowerCase()),
        ),
      )
      .orderBy(asc(chainDeposits.blockNumber));

    return rows.map(toDeposit);
  }

  async confirmedTotal(
    chain: ChainId,
    address: string,
    asset: AssetCode,
  ): Promise<Money> {
    const deposits = await this.listByAddress(chain, address);
    return deposits
      .filter(
        (deposit) =>
          deposit.status === "CONFIRMED" && deposit.amount.asset === asset,
      )
      .reduce<Money>(
        (total, deposit) => ({
          amount: total.amount + deposit.amount.amount,
          asset,
        }),
        zero(asset),
      );
  }
}

export class DrizzleWatcherCursorRepository implements WatcherCursorRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async get(chain: ChainId, asset: AssetCode): Promise<bigint | null> {
    const [row] = await this.#db
      .select()
      .from(watcherCursors)
      .where(
        and(eq(watcherCursors.chain, chain), eq(watcherCursors.asset, asset)),
      )
      .limit(1);

    return row === undefined ? null : BigInt(row.lastBlock);
  }

  async set(chain: ChainId, asset: AssetCode, block: bigint): Promise<void> {
    await this.#db
      .insert(watcherCursors)
      .values({
        chain,
        asset,
        lastBlock: block.toString(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [watcherCursors.chain, watcherCursors.asset],
        set: { lastBlock: block.toString(), updatedAt: new Date() },
      });
  }
}

function toDepositAddress(
  row: typeof depositAddresses.$inferSelect,
): DepositAddress {
  if (!isChainId(row.chain)) {
    throw new ValidationError(`Stored chain "${row.chain}" is not supported`, {
      chain: row.chain,
    });
  }
  return {
    id: row.id,
    clearingTransactionId: row.clearingTransactionId,
    derivationIndex: row.derivationIndex,
    chain: row.chain,
    asset: toAsset(row.asset),
    address: row.address,
    createdAt: row.createdAt,
  };
}

function toDeposit(row: typeof chainDeposits.$inferSelect): Deposit {
  if (!isChainId(row.chain)) {
    throw new ValidationError(`Stored chain "${row.chain}" is not supported`, {
      chain: row.chain,
    });
  }
  return {
    id: row.id,
    chain: row.chain,
    txHash: row.txHash,
    logIndex: row.logIndex,
    address: row.address,
    amount: toMoney(row.amount, row.asset),
    blockNumber: BigInt(row.blockNumber),
    blockHash: row.blockHash,
    status: row.status as DepositStatus,
    firstSeenAt: row.firstSeenAt,
    ...(row.confirmedAt === null ? {} : { confirmedAt: row.confirmedAt }),
    ...(row.orphanedAt === null ? {} : { orphanedAt: row.orphanedAt }),
  };
}
```

Add the sequence by hand to the generated migration file, since Drizzle does not model sequences:

```sql
CREATE SEQUENCE IF NOT EXISTS deposit_address_index_seq START 1;
```

- [ ] **Step 6: Map the new columns in the existing repositories**

In `packages/db/src/repositories/clearing.ts`, add these two helpers and call them from the existing mappers — `toDeposit(row)` spread into the row-to-domain result, `depositColumns(transaction)` spread into the insert and update value objects:

```ts
import { isChainId } from "@mayarin/chain";
import type { ClearingDeposit, ClearingTransaction } from "@mayarin/clearing";

/**
 * The deposit block is set together or not at all, so a row missing any part of
 * it has no deposit rather than a half-built one.
 */
function toDeposit(
  row: typeof clearingTransactions.$inferSelect,
): ClearingDeposit | undefined {
  const { depositAsset, depositChain, depositAddress, depositAmount } = row;
  if (
    depositAsset === null ||
    depositChain === null ||
    depositAddress === null ||
    depositAmount === null ||
    row.depositRateMinorUnitsPerWholeUnit === null ||
    row.depositRateSource === null ||
    row.depositRateLockedAt === null
  ) {
    return undefined;
  }

  if (!isChainId(depositChain)) {
    throw new ValidationError(
      `Stored chain "${depositChain}" is not supported`,
      {
        chain: depositChain,
      },
    );
  }

  return {
    asset: toAsset(depositAsset),
    chain: depositChain,
    address: depositAddress,
    amount: toMoney(depositAmount, depositAsset),
    rate: {
      // Not stored: they are the source asset and the deposit asset, and a
      // second copy is a second thing that can disagree.
      from: toAsset(row.sourceAsset),
      to: toAsset(depositAsset),
      minorUnitsPerWholeUnit: BigInt(row.depositRateMinorUnitsPerWholeUnit),
      source: row.depositRateSource,
      lockedAt: row.depositRateLockedAt,
      ...(row.depositRateExpiresAt === null
        ? {}
        : { expiresAt: row.depositRateExpiresAt }),
    },
  };
}

function depositColumns(transaction: ClearingTransaction) {
  const deposit = transaction.deposit;
  if (deposit === undefined) {
    return {
      depositAsset: null,
      depositChain: null,
      depositAddress: null,
      depositAmount: null,
      depositRateMinorUnitsPerWholeUnit: null,
      depositRateSource: null,
      depositRateLockedAt: null,
      depositRateExpiresAt: null,
    };
  }

  return {
    depositAsset: deposit.asset,
    depositChain: deposit.chain,
    depositAddress: deposit.address,
    depositAmount: deposit.amount.amount.toString(),
    depositRateMinorUnitsPerWholeUnit:
      deposit.rate.minorUnitsPerWholeUnit.toString(),
    depositRateSource: deposit.rate.source,
    depositRateLockedAt: deposit.rate.lockedAt,
    depositRateExpiresAt: deposit.rate.expiresAt ?? null,
  };
}
```

In the row-to-domain mapper, add `...present("deposit", toDeposit(row))` alongside the existing optional fields.

In `packages/db/src/repositories/payment-intent.ts`, add the same pair for the rail:

```ts
import { isChainId } from "@mayarin/chain";
import type { PaymentRail } from "@mayarin/payment-intent";

function toPaymentRail(
  row: typeof paymentIntents.$inferSelect,
): PaymentRail | undefined {
  if (row.paymentAsset === null || row.paymentChain === null) return undefined;
  if (!isChainId(row.paymentChain)) {
    throw new ValidationError(
      `Stored chain "${row.paymentChain}" is not supported`,
      {
        chain: row.paymentChain,
      },
    );
  }
  return { asset: toAsset(row.paymentAsset), chain: row.paymentChain };
}

function paymentRailColumns(intent: PaymentIntent) {
  return {
    paymentAsset: intent.payment?.asset ?? null,
    paymentChain: intent.payment?.chain ?? null,
  };
}
```

and wire them the same way: `...present("payment", toPaymentRail(row))` in the reader, `...paymentRailColumns(intent)` in the insert and update value objects.

- [ ] **Step 7: Export the repositories**

`packages/db/src/index.ts` gains, keeping the list alphabetical:

```ts
export * from "./repositories/chain.ts";
```

- [ ] **Step 8: Run the tests and typecheck**

```bash
bun run db:up
export $(grep -E '^DATABASE_URL' .env) && bun run --cwd packages/db migrate
bun test packages/db && bun run typecheck
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add packages/db
git commit -m "feat(db): persist deposit addresses, deposits and watcher cursors

Both uniqueness guarantees are the database's: one address per clearing
transaction, one deposit row per (chain, tx_hash, log_index). The second is what
makes re-scanning a block range after a crash a no-op rather than a double
count.

The deposit rate's from and to are not stored — they are the source asset and
the deposit asset, and a second copy is a second thing that can disagree."
```

---

### Task 8: The viem chain client and HD deriver

**Files:**

- Create: `packages/providers/evm/package.json`
- Create: `packages/providers/evm/tsconfig.json`
- Create: `packages/providers/evm/src/deriver.ts`
- Create: `packages/providers/evm/src/client.ts`
- Create: `packages/providers/evm/src/index.ts`
- Test: `packages/providers/evm/test/deriver.test.ts`
- Test: `packages/providers/evm/test/client.test.ts`

**Interfaces:**

- Consumes: `ChainClient`, `DepositAddressDeriver`, `ChainId`, `TransferQuery`, `BlockRef`, `TransferLog` from `@mayarin/chain`.
- Produces: `HdDepositAddressDeriver` (constructed from `{ xpub: string; basePath?: string }`), `EvmChainClient` (constructed from `{ rpcUrls: Partial<Record<ChainId, string>>; tokens: Partial<Record<ChainId, Partial<Record<AssetCode, string>>>> }`).

- [ ] **Step 1: Create the package**

`packages/providers/evm/package.json`:

```json
{
  "name": "@mayarin/provider-evm",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@mayarin/chain": "workspace:*",
    "@mayarin/shared": "workspace:*",
    "viem": "^2.21.0"
  }
}
```

`packages/providers/evm/tsconfig.json`:

```json
{
  "extends": "../../../tsconfig.base.json",
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

Run `bun install`.

- [ ] **Step 2: Write the failing deriver test**

The test cross-checks the xpub path against viem's own private-key derivation from the standard test mnemonic, so no address constant has to be trusted.

`packages/providers/evm/test/deriver.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { HDKey, mnemonicToAccount } from "viem/accounts";
import { HdDepositAddressDeriver } from "../src/deriver.ts";

/** The public Hardhat/Anvil test mnemonic. Never used for real funds. */
const MNEMONIC = "test test test test test test test test test test test junk";
const BASE_PATH = "m/44'/60'/0'/0";

function accountXpub(): string {
  const account = mnemonicToAccount(MNEMONIC);
  const master = account.getHdKey();
  const branch = master.derive(BASE_PATH);
  const xpub = branch.publicExtendedKey;
  if (xpub === null) throw new Error("expected an extended public key");
  return xpub;
}

describe("HdDepositAddressDeriver", () => {
  test("derives the same address the private key would", () => {
    const deriver = new HdDepositAddressDeriver({ xpub: accountXpub() });

    for (const index of [0, 1, 7]) {
      const expected = mnemonicToAccount(MNEMONIC, {
        addressIndex: index,
      }).address.toLowerCase();
      expect(deriver.derive(index)).toBe(expected);
    }
  });

  test("is deterministic across instances", () => {
    const xpub = accountXpub();
    expect(new HdDepositAddressDeriver({ xpub }).derive(3)).toBe(
      new HdDepositAddressDeriver({ xpub }).derive(3),
    );
  });

  test("gives distinct addresses to distinct indices", () => {
    const deriver = new HdDepositAddressDeriver({ xpub: accountXpub() });
    expect(deriver.derive(0)).not.toBe(deriver.derive(1));
  });

  test("rejects a malformed extended public key at construction", () => {
    expect(
      () => new HdDepositAddressDeriver({ xpub: "not-an-xpub" }),
    ).toThrow();
  });

  test("keeps HDKey out of the picture for private keys", () => {
    const deriver = new HdDepositAddressDeriver({ xpub: accountXpub() });
    expect(HDKey.fromExtendedKey(accountXpub()).privateKey).toBeNull();
    expect(deriver.derive(0)).toMatch(/^0x[0-9a-f]{40}$/);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test packages/providers/evm/test/deriver.test.ts`
Expected: FAIL — `Cannot find module '../src/deriver.ts'`.

- [ ] **Step 4: Implement the deriver**

`packages/providers/evm/src/deriver.ts`:

```ts
/**
 * HD deposit address derivation.
 *
 * Constructed from an extended *public* key, so this class cannot produce a
 * private key even in principle: a bug here cannot move funds, because the
 * process holds nothing to move them with. Signing belongs to the Settlement
 * Engine, with its own custody.
 */

import type { DepositAddressDeriver } from "@mayarin/chain";
import { ConfigurationError } from "@mayarin/shared";
import { HDKey } from "viem/accounts";
import { publicKeyToAddress } from "viem/utils";

export interface HdDepositAddressDeriverOptions {
  /** Extended public key for the branch addresses are derived under. */
  readonly xpub: string;
}

export class HdDepositAddressDeriver implements DepositAddressDeriver {
  readonly #branch: HDKey;

  constructor(options: HdDepositAddressDeriverOptions) {
    try {
      this.#branch = HDKey.fromExtendedKey(options.xpub);
    } catch (error) {
      throw new ConfigurationError(
        "DEPOSIT_XPUB is not a valid extended public key",
        {},
        {
          cause: error,
        },
      );
    }
  }

  derive(index: number): string {
    if (!Number.isInteger(index) || index < 0) {
      throw new ConfigurationError(
        `Derivation index must be a non-negative integer, got ${index}`,
        {
          index,
        },
      );
    }

    const child = this.#branch.deriveChild(index);
    const publicKey = child.publicKey;
    if (publicKey === null) {
      throw new ConfigurationError(
        `Could not derive a public key at index ${index}`,
        { index },
      );
    }

    return publicKeyToAddress(toUncompressedHex(child)).toLowerCase();
  }
}

/**
 * `publicKeyToAddress` hashes the uncompressed key; HDKey stores the compressed
 * form, so the point is expanded through the library's own curve helpers.
 */
function toUncompressedHex(key: HDKey): `0x${string}` {
  const uncompressed = key.publicKeyUncompressed;
  if (uncompressed === null) {
    throw new ConfigurationError(
      "Derived key has no uncompressed public key",
      {},
    );
  }
  return `0x${Buffer.from(uncompressed).toString("hex")}` as `0x${string}`;
}
```

If `HDKey` in the installed viem version does not expose `publicKeyUncompressed`, use `@noble/secp256k1`'s `ProjectivePoint.fromHex(child.publicKey).toRawBytes(false)` instead — viem already depends on it. Verify against the test before moving on; the test is the arbiter, not this note.

- [ ] **Step 5: Run the deriver test**

Run: `bun test packages/providers/evm/test/deriver.test.ts`
Expected: 5 tests pass. If the address does not match, the derivation path or the point encoding is wrong — fix it here, not in the test.

- [ ] **Step 6: Write the failing client test**

`packages/providers/evm/test/client.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { EvmChainClient } from "../src/client.ts";

const RPC_URLS = process.env.CHAIN_RPC_URLS;

describe.skipIf(RPC_URLS === undefined)("EvmChainClient", () => {
  const client = new EvmChainClient({
    rpcUrls: JSON.parse(RPC_URLS ?? "{}"),
    tokens: JSON.parse(process.env.CHAIN_ASSETS ?? "{}"),
  });

  test("reads the head block", async () => {
    const head = await client.head("base-sepolia");
    expect(head.number).toBeGreaterThan(0n);
    expect(head.hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  test("reads a canonical block hash at a height", async () => {
    const head = await client.head("base-sepolia");
    expect(await client.blockHash("base-sepolia", head.number)).toBe(head.hash);
  });

  test("returns null above the head", async () => {
    const head = await client.head("base-sepolia");
    expect(
      await client.blockHash("base-sepolia", head.number + 1_000_000n),
    ).toBeNull();
  });

  test("returns no logs for an address that never received anything", async () => {
    const head = await client.head("base-sepolia");
    const logs = await client.transfers({
      chain: "base-sepolia",
      asset: "USDC",
      fromBlock: head.number - 10n,
      toBlock: head.number,
      addresses: ["0x0000000000000000000000000000000000000001"],
    });
    expect(logs).toEqual([]);
  });
});

describe("EvmChainClient configuration", () => {
  test("refuses a chain with no RPC URL", async () => {
    const client = new EvmChainClient({ rpcUrls: {}, tokens: {} });
    await expect(client.head("base-sepolia")).rejects.toThrow(/RPC/i);
  });

  test("refuses an asset with no token address", async () => {
    const client = new EvmChainClient({
      rpcUrls: { "base-sepolia": "https://sepolia.base.org" },
      tokens: {},
    });
    await expect(
      client.transfers({
        chain: "base-sepolia",
        asset: "USDC",
        fromBlock: 1n,
        toBlock: 2n,
        addresses: ["0x0000000000000000000000000000000000000001"],
      }),
    ).rejects.toThrow(/token address/i);
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `bun test packages/providers/evm/test/client.test.ts`
Expected: FAIL — `Cannot find module '../src/client.ts'`. The network tests skip without `CHAIN_RPC_URLS`; the two configuration tests must run and fail.

- [ ] **Step 8: Implement the client**

`packages/providers/evm/src/client.ts`:

```ts
/**
 * viem-backed chain client.
 *
 * Deliberately thin: three RPC calls, no caching, no reorg logic. The policy
 * that decides what a transfer means lives in `@mayarin/chain`, which is what
 * lets it be tested without a network.
 */

import type {
  BlockRef,
  ChainClient,
  ChainId,
  TransferLog,
  TransferQuery,
} from "@mayarin/chain";
import {
  type AssetCode,
  ConfigurationError,
  ProviderError,
} from "@mayarin/shared";
import {
  createPublicClient,
  getAddress,
  http,
  parseAbiItem,
  type PublicClient,
} from "viem";
import { base, baseSepolia } from "viem/chains";

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

const CHAINS = { base, "base-sepolia": baseSepolia } as const;

export interface EvmChainClientOptions {
  readonly rpcUrls: Readonly<Partial<Record<ChainId, string>>>;
  /** ERC-20 contract address per chain and asset. */
  readonly tokens: Readonly<
    Partial<Record<ChainId, Readonly<Partial<Record<AssetCode, string>>>>>
  >;
}

export class EvmChainClient implements ChainClient {
  readonly #rpcUrls: EvmChainClientOptions["rpcUrls"];
  readonly #tokens: EvmChainClientOptions["tokens"];
  readonly #clients = new Map<ChainId, PublicClient>();

  constructor(options: EvmChainClientOptions) {
    this.#rpcUrls = options.rpcUrls;
    this.#tokens = options.tokens;
  }

  async head(chain: ChainId): Promise<BlockRef> {
    const block = await this.#call(chain, (client) =>
      client.getBlock({ blockTag: "latest" }),
    );
    return { number: block.number ?? 0n, hash: block.hash ?? "" };
  }

  async blockHash(chain: ChainId, number: bigint): Promise<string | null> {
    try {
      const block = await this.#call(chain, (client) =>
        client.getBlock({ blockNumber: number }),
      );
      return block.hash;
    } catch (error) {
      // A height the chain has not reached is a normal answer during a reorg,
      // not a fault — the policy reads `null` as "no evidence either way".
      if (isBlockNotFound(error)) return null;
      throw error;
    }
  }

  async transfers(query: TransferQuery): Promise<TransferLog[]> {
    if (query.addresses.length === 0) return [];

    const token = this.#tokenAddress(query.chain, query.asset);
    const logs = await this.#call(query.chain, (client) =>
      client.getLogs({
        address: token,
        event: TRANSFER_EVENT,
        args: { to: query.addresses.map((address) => getAddress(address)) },
        fromBlock: query.fromBlock,
        toBlock: query.toBlock,
      }),
    );

    return logs.flatMap((log) => {
      if (
        log.blockNumber === null ||
        log.blockHash === null ||
        log.transactionHash === null
      ) {
        return [];
      }
      if (
        log.logIndex === null ||
        log.args.to === undefined ||
        log.args.value === undefined
      ) {
        return [];
      }
      return [
        {
          chain: query.chain,
          asset: query.asset,
          txHash: log.transactionHash,
          logIndex: log.logIndex,
          blockNumber: log.blockNumber,
          blockHash: log.blockHash,
          from: (log.args.from ?? "").toLowerCase(),
          to: log.args.to.toLowerCase(),
          amount: log.args.value,
        },
      ];
    });
  }

  #tokenAddress(chain: ChainId, asset: AssetCode): `0x${string}` {
    const address = this.#tokens[chain]?.[asset];
    if (address === undefined) {
      throw new ConfigurationError(
        `No token address configured for ${asset} on ${chain}`,
        {
          chain,
          asset,
        },
      );
    }
    return getAddress(address);
  }

  #clientFor(chain: ChainId): PublicClient {
    const cached = this.#clients.get(chain);
    if (cached !== undefined) return cached;

    const url = this.#rpcUrls[chain];
    if (url === undefined) {
      throw new ConfigurationError(`No RPC URL configured for ${chain}`, {
        chain,
      });
    }

    const client = createPublicClient({
      chain: CHAINS[chain],
      transport: http(url),
    });
    this.#clients.set(chain, client);
    return client;
  }

  /** RPC faults are retryable: the watcher's next tick picks the work back up. */
  async #call<T>(
    chain: ChainId,
    fn: (client: PublicClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await fn(this.#clientFor(chain));
    } catch (error) {
      if (error instanceof ConfigurationError || isBlockNotFound(error))
        throw error;
      throw new ProviderError(
        `EVM RPC call failed for ${chain}: ${error instanceof Error ? error.message : String(error)}`,
        { chain },
        { cause: error, retryable: true },
      );
    }
  }
}

function isBlockNotFound(error: unknown): boolean {
  return error instanceof Error && /block.*not found/i.test(error.message);
}
```

- [ ] **Step 9: Write the barrel**

`packages/providers/evm/src/index.ts`:

```ts
export * from "./client.ts";
export * from "./deriver.ts";
```

- [ ] **Step 10: Run the tests and typecheck**

Run: `bun test packages/providers/evm && bun run typecheck`
Expected: 11 tests, of which the 4 network tests skip without `CHAIN_RPC_URLS`.

- [ ] **Step 11: Commit**

```bash
git add packages/providers/evm package.json bun.lock
git commit -m "feat(evm): add the viem chain client and HD address deriver

The deriver is constructed from an extended public key and cannot produce a
private key even in principle, so a bug in the watch path cannot move funds.

A block-not-found answer is passed through as null rather than raised: during a
reorg the head can briefly sit below a known deposit, and that is no evidence
the deposit was orphaned."
```

---

### Task 9: Configuration and composition root

**Files:**

- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/container.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/package.json`
- Test: `apps/api/test/config.test.ts` (new file)

**Interfaces:**

- Consumes: everything above.
- Produces: `Config.chain?: ChainConfig` (with `pairs: readonly { chain: ChainId; asset: AssetCode }[]`), `Container.watchers: ReadonlyMap<ChainId, WalletWatcher>`, `Container.deposits?: DrizzleDepositRepository`.

- [ ] **Step 1: Add the dependencies**

In `apps/api/package.json`, add to `dependencies`:

```json
    "@mayarin/chain": "workspace:*",
    "@mayarin/provider-evm": "workspace:*",
```

Run `bun install`.

- [ ] **Step 2: Write the failing config test**

`apps/api/test/config.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config.ts";

const BASE = { DATABASE_URL: "postgres://localhost:5433/mayarin" } as const;
const XPUB =
  "xpub6EF8jXqFeFEW5bwMU7RpQtHkzE4KJxcqJtvkCjJumzW8CPpacXkb92ek4WzLQXjL93HycJwTPUAcuNxCqFPKKU5m5Z2Vq4nCyh5CyPeBFFr";

describe("chain configuration", () => {
  test("is absent unless enabled", () => {
    expect(loadConfig({ ...BASE }).chain).toBeUndefined();
  });

  test("parses the chain block when enabled", () => {
    const config = loadConfig({
      ...BASE,
      CHAIN_ENABLED: "true",
      ASSET_RECEIPT_MODE: "manual",
      CHAIN_RPC_URLS: '{"base-sepolia":"https://sepolia.base.org"}',
      CHAIN_ASSETS:
        '{"base-sepolia":{"USDC":"0x036CbD53842c5426634e7929541eC2318f3dCF7e"}}',
      CHAIN_CONFIRMATIONS: '{"base-sepolia":6}',
      DEPOSIT_XPUB: XPUB,
    });

    expect(config.chain?.confirmations["base-sepolia"]).toBe(6);
    expect(config.chain?.pairs).toEqual([
      { chain: "base-sepolia", asset: "USDC" },
    ]);
  });

  test("refuses to boot with the watcher on and asset receipt on auto", () => {
    expect(() =>
      loadConfig({
        ...BASE,
        CHAIN_ENABLED: "true",
        ASSET_RECEIPT_MODE: "auto",
        CHAIN_RPC_URLS: '{"base-sepolia":"https://sepolia.base.org"}',
        CHAIN_ASSETS:
          '{"base-sepolia":{"USDC":"0x036CbD53842c5426634e7929541eC2318f3dCF7e"}}',
        DEPOSIT_XPUB: XPUB,
      }),
    ).toThrow(/ASSET_RECEIPT_MODE/);
  });

  test("refuses to boot with no deposit xpub", () => {
    expect(() =>
      loadConfig({
        ...BASE,
        CHAIN_ENABLED: "true",
        ASSET_RECEIPT_MODE: "manual",
        CHAIN_RPC_URLS: '{"base-sepolia":"https://sepolia.base.org"}',
        CHAIN_ASSETS:
          '{"base-sepolia":{"USDC":"0x036CbD53842c5426634e7929541eC2318f3dCF7e"}}',
      }),
    ).toThrow(/DEPOSIT_XPUB/);
  });

  test("refuses a configured asset with no RPC URL for its chain", () => {
    expect(() =>
      loadConfig({
        ...BASE,
        CHAIN_ENABLED: "true",
        ASSET_RECEIPT_MODE: "manual",
        CHAIN_RPC_URLS: "{}",
        CHAIN_ASSETS:
          '{"base-sepolia":{"USDC":"0x036CbD53842c5426634e7929541eC2318f3dCF7e"}}',
        DEPOSIT_XPUB: XPUB,
      }),
    ).toThrow(/RPC/i);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `bun test apps/api/test/config.test.ts`
Expected: FAIL — `config.chain` does not exist.

- [ ] **Step 4: Extend the config schema**

In `apps/api/src/config.ts`, add the imports:

```ts
import { CHAIN_IDS, type ChainId } from "@mayarin/chain";
import type { AssetCode } from "@mayarin/shared";
```

Add a JSON-object helper beside the existing `exchangeRates` transform:

```ts
/** Parses a JSON env var into a plain object, failing the boot rather than the first request. */
function jsonObject<T>(name: string, fallback: string) {
  return z
    .string()
    .default(fallback)
    .transform((value, ctx): T => {
      try {
        return JSON.parse(value) as T;
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${name} must be valid JSON`,
        });
        return z.NEVER;
      }
    });
}
```

Add the raw chain fields to `configSchema`:

```ts
  chainEnabled: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  chainRpcUrls: jsonObject<Partial<Record<ChainId, string>>>("CHAIN_RPC_URLS", "{}"),
  chainAssets:
    jsonObject<Partial<Record<ChainId, Partial<Record<AssetCode, string>>>>>("CHAIN_ASSETS", "{}"),
  chainConfirmations: jsonObject<Partial<Record<ChainId, number>>>("CHAIN_CONFIRMATIONS", "{}"),
  chainStartBlocks: jsonObject<Partial<Record<ChainId, string>>>("CHAIN_START_BLOCKS", "{}"),
  depositXpub: z.string().min(1).optional(),
  watcherIntervalMs: z.coerce.number().int().min(0).default(15_000),
  watcherBlockRange: z.coerce.number().int().positive().default(2_000),
  watcherRetentionSeconds: z.coerce.number().int().positive().default(86_400),
  watcherReorgWatchWindow: z.coerce.number().int().positive().default(2),
  adminToken: z.string().min(16).optional(),
```

Extend `loadConfig` to read the matching env vars, then post-process the parsed data into the resolved shape before returning:

```ts
export interface ChainConfig {
  readonly rpcUrls: Readonly<Partial<Record<ChainId, string>>>;
  readonly tokens: Readonly<
    Partial<Record<ChainId, Readonly<Partial<Record<AssetCode, string>>>>>
  >;
  readonly confirmations: Readonly<Record<ChainId, number>>;
  readonly startBlocks: Readonly<Partial<Record<ChainId, bigint>>>;
  readonly xpub: string;
  readonly intervalMs: number;
  readonly blockRange: number;
  readonly retentionSeconds: number;
  readonly reorgWatchWindow: number;
  /** Every (chain, asset) the watcher ticks, derived from CHAIN_ASSETS. */
  readonly pairs: readonly {
    readonly chain: ChainId;
    readonly asset: AssetCode;
  }[];
}
```

```ts
/**
 * Resolves the chain block, or `undefined` when the layer is off.
 *
 * Every check here is a boot-time failure by design: a deployment that watches
 * nothing, or auto-confirms payments while a watcher is running, is a
 * misconfiguration that must not survive to serve a single payment.
 */
function resolveChain(data: RawConfig): ChainConfig | undefined {
  if (!data.chainEnabled) return undefined;

  const issues: string[] = [];

  if (data.assetReceiptMode === "auto") {
    issues.push(
      "ASSET_RECEIPT_MODE must be `manual` when CHAIN_ENABLED is true: auto-confirming " +
        "alongside a live watcher would fund payments nobody paid",
    );
  }
  if (data.depositXpub === undefined) {
    issues.push("DEPOSIT_XPUB is required when CHAIN_ENABLED is true");
  }

  const pairs: { chain: ChainId; asset: AssetCode }[] = [];
  const confirmations: Partial<Record<ChainId, number>> = {};

  for (const [chain, tokens] of Object.entries(data.chainAssets)) {
    if (!(CHAIN_IDS as readonly string[]).includes(chain)) {
      issues.push(`CHAIN_ASSETS names an unsupported chain "${chain}"`);
      continue;
    }
    const chainId = chain as ChainId;
    if (data.chainRpcUrls[chainId] === undefined) {
      issues.push(
        `CHAIN_ASSETS configures ${chainId} but CHAIN_RPC_URLS has no RPC URL for it`,
      );
    }
    confirmations[chainId] = data.chainConfirmations[chainId] ?? 6;
    for (const asset of Object.keys(tokens ?? {})) {
      pairs.push({ chain: chainId, asset: asset as AssetCode });
    }
  }

  if (pairs.length === 0) {
    issues.push(
      "CHAIN_ASSETS must configure at least one token when CHAIN_ENABLED is true",
    );
  }

  if (issues.length > 0) {
    throw new ConfigurationError("Invalid chain configuration", { issues });
  }

  return {
    rpcUrls: data.chainRpcUrls,
    tokens: data.chainAssets,
    confirmations: confirmations as Record<ChainId, number>,
    startBlocks: Object.fromEntries(
      Object.entries(data.chainStartBlocks).map(([chain, block]) => [
        chain,
        BigInt(block ?? "0"),
      ]),
    ),
    xpub: data.depositXpub ?? "",
    intervalMs: data.watcherIntervalMs,
    blockRange: data.watcherBlockRange,
    retentionSeconds: data.watcherRetentionSeconds,
    reorgWatchWindow: data.watcherReorgWatchWindow,
    pairs,
  };
}
```

`Config` becomes `z.infer<typeof configSchema> & { chain?: ChainConfig }`, and `loadConfig` returns `{ ...result.data, ...(chain === undefined ? {} : { chain }) }`. Name the inferred raw type `RawConfig`.

- [ ] **Step 5: Wire the container**

In `apps/api/src/container.ts`, add the imports:

```ts
import { type ChainId, WalletWatcher } from "@mayarin/chain";
import {
  DrizzleDepositAddressRepository,
  DrizzleDepositRepository,
  DrizzleWatcherCursorRepository,
} from "@mayarin/db";
import { EvmChainClient, HdDepositAddressDeriver } from "@mayarin/provider-evm";
```

Add to `Container`:

```ts
  /**
   * One watcher per chain, because confirmation depth is per chain: a single
   * watcher would have to pick one depth and apply it to chains that do not
   * share it. Empty when the chain layer is off.
   */
  readonly watchers: ReadonlyMap<ChainId, WalletWatcher>;
  /** Present only when the chain layer is enabled. */
  readonly deposits?: DrizzleDepositRepository;
```

Inside `createContainer`, before the engine is built:

```ts
const chain = config.chain;
const depositAddresses =
  chain === undefined
    ? undefined
    : new DrizzleDepositAddressRepository(handle.db);
const depositDeriver =
  chain === undefined
    ? undefined
    : new HdDepositAddressDeriver({ xpub: chain.xpub });
```

Add to the `ClearingEngine` options:

```ts
    ...(depositAddresses === undefined ? {} : { depositAddresses }),
    ...(depositDeriver === undefined ? {} : { depositDeriver }),
```

After the engine, build one watcher per configured chain:

```ts
const watchers = new Map<ChainId, WalletWatcher>();
let deposits: DrizzleDepositRepository | undefined;

if (chain !== undefined && depositAddresses !== undefined) {
  deposits = new DrizzleDepositRepository(handle.db);
  const client = new EvmChainClient({
    rpcUrls: chain.rpcUrls,
    tokens: chain.tokens,
  });
  const cursors = new DrizzleWatcherCursorRepository(handle.db);

  // The watcher speaks to the engine through a sink rather than importing it:
  // `@mayarin/chain` must not depend on `@mayarin/clearing`.
  const sink = {
    fund: async (clearingTransactionId: string) => {
      await engine.recordAssetReceived(clearingTransactionId);
    },
  };

  for (const chainId of new Set(chain.pairs.map((pair) => pair.chain))) {
    watchers.set(
      chainId,
      new WalletWatcher({
        client,
        addresses: depositAddresses,
        deposits,
        cursors,
        sink,
        clock,
        events,
        policy: {
          depth: chain.confirmations[chainId],
          reorgWatchWindow: chain.reorgWatchWindow,
        },
        blockRange: chain.blockRange,
        retentionSeconds: chain.retentionSeconds,
        startBlocks: chain.startBlocks,
      }),
    );
  }
}
```

Return `watchers` and `...(deposits === undefined ? {} : { deposits })` from the container.

- [ ] **Step 6: Start the interval**

In `apps/api/src/index.ts`, after the existing `resumeStuck` block:

```ts
const chain = config.chain;
if (
  chain !== undefined &&
  chain.intervalMs > 0 &&
  container.watchers.size > 0
) {
  setInterval(() => {
    void (async () => {
      for (const pair of chain.pairs) {
        const watcher = container.watchers.get(pair.chain);
        if (watcher === undefined) continue;
        try {
          await watcher.tick(pair.chain, pair.asset);
        } catch (error) {
          // A failed pass is not fatal: the cursor was not advanced, so the next
          // tick re-scans the same range.
          console.error(
            `[watcher] ${pair.chain}/${pair.asset} tick failed`,
            error,
          );
        }
      }
    })();
  }, chain.intervalMs);
  console.log(
    `[watcher] polling ${chain.pairs.length} pair(s) every ${chain.intervalMs}ms`,
  );
}
```

- [ ] **Step 7: Run the tests and typecheck**

Run: `bun test apps/api && bun run typecheck`
Expected: the 5 config tests pass and the existing route tests are unaffected.

- [ ] **Step 8: Commit**

```bash
git add apps/api package.json bun.lock
git commit -m "feat(api): wire the chain layer into the composition root

The chain block is off unless CHAIN_ENABLED, so an existing deployment boots
unchanged. Enabling it while ASSET_RECEIPT_MODE is auto is a boot failure: auto
confirmation alongside a live watcher would fund payments nobody paid, and that
should not survive to serve a single request.

A failed watcher pass leaves the cursor where it was, so the next tick re-scans
the same range rather than skipping it."
```

---

### Task 10: API surface

**Files:**

- Modify: `apps/api/src/routes/payment-intents.ts`
- Create: `apps/api/src/routes/admin.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/serialization.ts`
- Modify: `apps/api/test/harness.ts`
- Test: `apps/api/test/routes.test.ts` (append)

**Interfaces:**

- Consumes: `Container.watchers`, `Container.deposits`, `Config.chain`, `Config.adminToken`, `ClearingTransaction.deposit`, `Deposit`.
- Produces: `toDepositDto(transaction, deposits, headNumber, requiredConfirmations)`, `adminRoutes(container, token)`, and the `deposit` block on the payment DTO.

- [ ] **Step 1: Write the failing route tests**

Append to `apps/api/test/routes.test.ts`:

```ts
describe("payment rail", () => {
  test("rejects an unsupported chain", async () => {
    const response = await app.request("/payment-intents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        merchant: {
          id: "M1",
          name: "Warung",
          city: "Jakarta",
          countryCode: "ID",
        },
        amount: { amount: "50000.00", asset: "IDR" },
        payment: { asset: "USDC", chain: "dogecoin" },
      }),
    });

    expect(response.status).toBe(400);
  });

  test("echoes the rail on the created intent", async () => {
    const response = await app.request("/payment-intents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        merchant: {
          id: "M1",
          name: "Warung",
          city: "Jakarta",
          countryCode: "ID",
        },
        amount: { amount: "50000.00", asset: "IDR" },
        payment: { asset: "USDC", chain: "base-sepolia" },
      }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      paymentIntent: { payment: { asset: string; chain: string } | null };
    };
    expect(body.paymentIntent.payment).toEqual({
      asset: "USDC",
      chain: "base-sepolia",
    });
  });
});

describe("admin routes", () => {
  test("are not registered without an admin token", async () => {
    expect(
      (await app.request("/admin/watcher/tick", { method: "POST" })).status,
    ).toBe(404);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test apps/api/test/routes.test.ts`
Expected: FAIL on the echo test — `payment` is not accepted by the create body schema.

- [ ] **Step 3: Accept the rail on the create route**

In `apps/api/src/routes/payment-intents.ts`, add to the imports:

```ts
import { CHAIN_IDS } from "@mayarin/chain";
```

Add to `createBodySchema`:

```ts
    /** The rail the payer intends to pay on, e.g. USDC on Base. */
    payment: z
      .object({ asset: assetCodeSchema, chain: z.enum(CHAIN_IDS) })
      .optional(),
```

and to the `command` object:

```ts
      ...(body.payment === undefined ? {} : { payment: body.payment }),
```

- [ ] **Step 4: Serialize the rail and the deposit block**

In `apps/api/src/serialization.ts`, add to `toPaymentIntentDto`, after `provider`:

```ts
    payment: intent.payment ?? null,
```

Add the deposit DTO:

```ts
import type { Deposit } from "@mayarin/chain";
import { isOrphanedAfterConfirmed } from "@mayarin/chain";
import { zero } from "@mayarin/shared";

/**
 * The payer's side of a payment.
 *
 * `received` counts CONFIRMED deposits only — it is the number the funding rule
 * uses, so showing anything else would explain the payment incorrectly.
 * `deposits` is the per-transfer record that makes a half-paid payment
 * diagnosable.
 */
export function toDepositDto(
  transaction: ClearingTransaction,
  deposits: readonly Deposit[],
  headNumber: bigint | undefined,
  requiredConfirmations: number,
) {
  const deposit = transaction.deposit;
  if (deposit === undefined) return null;

  const received = deposits
    .filter((entry) => entry.status === "CONFIRMED")
    .reduce(
      (total, entry) => ({
        amount: total.amount + entry.amount.amount,
        asset: deposit.asset,
      }),
      zero(deposit.asset),
    );

  return {
    address: deposit.address,
    chain: deposit.chain,
    asset: deposit.asset,
    amount: toMoneyDto(deposit.amount),
    received: toMoneyDto(received),
    required: requiredConfirmations,
    reviewRequired: deposits.some(isOrphanedAfterConfirmed),
    deposits: deposits.map((entry) => ({
      txHash: entry.txHash,
      logIndex: entry.logIndex,
      amount: toMoneyDto(entry.amount),
      status: entry.status,
      confirmations:
        headNumber === undefined || entry.blockNumber > headNumber
          ? 0
          : Number(headNumber - entry.blockNumber) + 1,
      firstSeenAt: entry.firstSeenAt.toISOString(),
    })),
  };
}
```

Add a `deposit` parameter to `toPaymentDto`:

```ts
export function toPaymentDto(
  intent: PaymentIntent,
  transaction: ClearingTransaction | null,
  events: readonly ClearingEvent[] = [],
  deposit: ReturnType<typeof toDepositDto> = null,
) {
  return {
    paymentIntent: toPaymentIntentDto(intent),
    clearing: transaction === null ? null : toClearingDto(transaction),
    deposit,
    timeline: toTimelineDto(events),
  };
}
```

Existing callers pass three arguments and keep working. In `apps/api/src/routes/payments.ts`, add this helper and pass its result as the fourth argument at both call sites:

```ts
/**
 * Reads the payer's side of a payment, or null when this deployment has no
 * chain layer. Confirmations are display-only, so an unreachable RPC renders
 * them as zero rather than failing the whole read.
 */
async function depositFor(
  container: Container,
  transaction: ClearingTransaction | null,
) {
  const deposit = transaction?.deposit;
  const repository = container.deposits;
  const chain = container.config.chain;
  if (transaction === null || deposit === undefined || repository === undefined)
    return null;
  if (chain === undefined) return null;

  const deposits = await repository.listByAddress(
    deposit.chain,
    deposit.address,
  );
  const head = await container
    .chainHead?.(deposit.chain)
    .catch(() => undefined);

  return toDepositDto(
    transaction,
    deposits,
    head?.number,
    chain.confirmations[deposit.chain],
  );
}
```

This needs one more container field. In Task 9's `Container` interface add:

```ts
  /** Current head of a chain, for rendering confirmation counts. */
  readonly chainHead?: (chain: ChainId) => Promise<BlockRef>;
```

and inside the `if (chain !== undefined && depositAddresses !== undefined)` block, after `client` is constructed, capture `const chainHead = (id: ChainId) => client.head(id);` and return `...(chainHead === undefined ? {} : { chainHead })` from the container alongside `deposits`.

- [ ] **Step 5: Add the admin routes**

`apps/api/src/routes/admin.ts`:

```ts
/**
 * Admin routes.
 *
 * Registered only when `ADMIN_TOKEN` is set — an unconfigured deployment
 * returns 404 rather than exposing an unauthenticated trigger.
 */

import { ValidationError } from "@mayarin/shared";
import { Hono } from "hono";
import type { Container } from "../container.ts";

export function adminRoutes(container: Container, token: string): Hono {
  const app = new Hono();

  app.use("*", async (c, next) => {
    if (c.req.header("authorization") !== `Bearer ${token}`) {
      return c.json(
        { error: { code: "UNAUTHORIZED", message: "Invalid admin token" } },
        401,
      );
    }
    await next();
  });

  /** Forces one watcher pass over every configured pair. */
  app.post("/watcher/tick", async (c) => {
    const chain = container.config.chain;
    if (chain === undefined || container.watchers.size === 0) {
      throw new ValidationError(
        "The chain layer is not enabled on this deployment",
      );
    }

    const results = [];
    for (const pair of chain.pairs) {
      const watcher = container.watchers.get(pair.chain);
      if (watcher === undefined) continue;
      const result = await watcher.tick(pair.chain, pair.asset);
      results.push({
        chain: result.chain,
        asset: result.asset,
        scannedFrom: result.scannedFrom.toString(),
        scannedTo: result.scannedTo.toString(),
        recorded: result.recorded,
        confirmed: result.confirmed,
        orphaned: result.orphaned,
        funded: result.funded,
      });
    }

    return c.json({ passes: results });
  });

  return app;
}
```

In `apps/api/src/app.ts`, after the existing routes:

```ts
const adminToken = container.config.adminToken;
if (adminToken !== undefined) {
  app.route("/admin", adminRoutes(container, adminToken));
}
```

- [ ] **Step 6: Run the tests and typecheck**

Run: `bun test apps/api && bun run typecheck`
Expected: the 3 new tests pass, all existing route tests unchanged.

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): expose the deposit address and its transfers

received counts CONFIRMED deposits only, because that is the number the funding
rule uses — anything else would explain the payment incorrectly. The per-
transfer list is what makes a half-paid payment diagnosable.

Admin routes are not registered at all without ADMIN_TOKEN, so an unconfigured
deployment 404s rather than exposing an unauthenticated trigger."
```

---

### Task 11: Documentation

`docs/` is the design record and is expected to stay in sync with the code. This task is not optional.

**Files:**

- Create: `docs/chain.md`
- Modify: `docs/README.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/architecture.md`
- Modify: `docs/clearing-engine.md`
- Modify: `docs/development.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Write `docs/chain.md`**

Follow the house style of the existing docs — a `[← Documentation index](./README.md)` header and footer, a `## Related` section, prose that explains _why_ rather than restating the code. Cover: per-intent deposit addresses and why HD derivation from a watch-only xpub; the third asset leg and the two rate locks; the watcher's tick and why the cursor is written last; confirmation depth as the finality line; accumulate-and-confirm; what an orphaned-after-confirmed deposit means and why nothing is auto-reversed; the configuration variables. Source the reasoning from `docs/superpowers/specs/2026-08-03-phase2-chain-layer-design.md`.

- [ ] **Step 2: Update the index and roadmap**

Add `chain.md` to the list in `docs/README.md`.

In `docs/roadmap.md`, mark the Phase 2 Blockchain items shipped except Liquidity Router and Settlement Engine, and replace the Phase 1 paragraph's `ASSET_RECEIPT_MODE` stand-in note with a pointer to `chain.md`, keeping the note that prices are still locked against the static table until the Liquidity Router lands.

- [ ] **Step 3: Update architecture and clearing-engine**

In `docs/architecture.md`, add `packages/core/chain`, `packages/providers/evm` and `packages/providers/mock-chain` to the package tree and state the one-way dependency: chain does not import clearing; the composition root wires the sink.

In `docs/clearing-engine.md`, document the third asset leg and the two quotes taken at `PRICE_LOCKED`.

- [ ] **Step 4: Update development.md and CLAUDE.md**

In `docs/development.md`, document the new environment variables and how to run the watcher against Base Sepolia.

In `CLAUDE.md`, update the "Phase 1 stand-ins" section: the wallet watcher now exists, so only the static rate table remains. Add the chain packages to the architecture section.

- [ ] **Step 5: Verify the whole repo**

Run: `bun run check`
Expected: format, typecheck and the full test suite all pass.

- [ ] **Step 6: Commit**

```bash
git add docs CLAUDE.md
git commit -m "docs: document the chain layer

One of the two Phase 1 stand-ins is gone: something now observes the payer's
asset arriving. Prices are still locked against the static table, which is the
Liquidity Router's job in Phase 2C."
```

---

## Verification

The subsystem is complete when all of the following hold:

```bash
bun run check                                    # format, typecheck, full suite
bun test packages/core/chain                     # 20 policy + watcher tests
bun test packages/providers/mock-chain           # 8 fake-chain tests
bun test packages/providers/evm                  # 11 (4 skipped without an RPC URL)
```

With a database:

```bash
bun run db:up
export $(grep -E '^DATABASE_URL' .env) && bun run --cwd packages/db migrate
bun test packages/db
```

End to end against Base Sepolia, which is what proves the seam actually closed:

1. Set `CHAIN_ENABLED=true`, `ASSET_RECEIPT_MODE=manual`, `CHAIN_RPC_URLS`, `CHAIN_ASSETS`, `DEPOSIT_XPUB` and `ADMIN_TOKEN`.
2. `POST /payment-intents` with `payment: { asset: "USDC", chain: "base-sepolia" }`, then confirm it.
3. `GET /payments/:id` — read `deposit.address` and `deposit.amount`.
4. Send that amount of testnet USDC to that address.
5. `POST /admin/watcher/tick` repeatedly, or wait for the interval. Watch `deposit.deposits[0].confirmations` climb.
6. At the configured depth the payment reaches `SUCCESS` and `deposit.received` equals `deposit.amount`.
