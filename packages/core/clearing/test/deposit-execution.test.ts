import { describe, expect, test } from "bun:test";
import { assertBalanced } from "@mayarin/ledger";
import { money } from "@mayarin/shared";
import type { TreasuryExecutionPort } from "../src/treasury.ts";
import { createHarness } from "./harness.ts";

/**
 * The deposit path end to end, wired into the engine.
 *
 * The two receipt schemes are a pair — the split receipt stops crediting
 * `MERCHANT_PAYABLE` and the swap starts — so what is worth asserting is not
 * either posting alone but that a whole payment's books balance under both, and
 * that no payment ends up half on one scheme and half on the other.
 */

/** 50,000.00 IDR settles as 50,000.00 IDRX (0.50% fee) against a 16.000000 USDC deposit. */
const RATES = { "IDR/IDRX": 100n, "IDR/USDC": 320n };
const DEPOSIT = money(16_000_000n, "USDC");

function railIntent(harness: ReturnType<typeof createHarness>) {
  return harness.confirmedIntent({ payment: { asset: "USDC", chain: "base-sepolia" } });
}

const NEVER_CALLED: TreasuryExecutionPort = {
  async sweep() {
    throw new Error("should not sweep");
  },
  async execute() {
    throw new Error("should not execute");
  },
};

/** Every posting the payment produced, checked against the real guard. */
function assertEveryPostingBalances(harness: ReturnType<typeof createHarness>) {
  const entries = harness.repositories.ledger.entries();
  expect(entries.length).toBeGreaterThan(0);

  const byTransaction = new Map<string, typeof entries>();
  for (const entry of entries) {
    byTransaction.set(entry.transactionId, [
      ...(byTransaction.get(entry.transactionId) ?? []),
      entry,
    ]);
  }

  for (const group of byTransaction.values()) {
    expect(() => assertBalanced(group)).not.toThrow();
  }
}

describe("deposit path without a treasury executor", () => {
  test("keeps the original receipt, acquiring settlement at the moment of receipt", async () => {
    const harness = createHarness({ rates: RATES });

    const transaction = await harness.engine.start(await railIntent(harness));

    expect(transaction.state).toBe("SUCCESS");
    // Nothing converts the deposit, so settlement is acquired at receipt and the
    // pre-#69 posting is the correct one. The split would be actively wrong
    // here: `clearingPosting` would debit a payable nothing had credited.
    expect((await harness.ledger.balance("PAYER_ASSET_HELD", "USDC")).balance).toEqual(
      money(0n, "USDC"),
    );
    assertEveryPostingBalances(harness);
  });

  test("an intent with no deposit leg is untouched by any of this", async () => {
    const harness = createHarness({ rates: RATES, treasuryPort: NEVER_CALLED });

    const transaction = await harness.engine.start(await harness.confirmedIntent());

    expect(transaction.state).toBe("SUCCESS");
    expect(transaction.deposit).toBeUndefined();
    assertEveryPostingBalances(harness);
  });
});

describe("deposit path with a treasury executor but no signed order", () => {
  /**
   * The gap this pins. `PRICE_LOCKED` signs an order only on the
   * `on-chain-contract` path — `contractPlanner` is not consulted for
   * `deposit-match` — so a deposit-path transaction reaches `ASSET_RECEIVED`
   * with `contract` undefined and there is nothing for the router to verify.
   *
   * The executor refuses rather than improvising, which is the behaviour worth
   * having: it holds no signer, and an order signed at execution time would be
   * a second order for one payment.
   */
  test("fails loudly instead of settling a payment the router would reject", async () => {
    const harness = createHarness({ rates: RATES, treasuryPort: NEVER_CALLED });

    const transaction = await harness.engine.start(await railIntent(harness));

    expect(transaction.state).toBe("FAILED");
    const failure = harness.published.find((event) => event.type === "clearing.failed");
    expect(failure).toBeDefined();
    expect((failure?.payload as { code?: string } | undefined)?.code).toBe("EXECUTION_EXHAUSTED");
  });

  test("leaves the payer asset visible and held, not silently cleared", async () => {
    const harness = createHarness({ rates: RATES, treasuryPort: NEVER_CALLED });

    await harness.engine.start(await railIntent(harness));

    // Exactly the state RFC #70 exists to make representable. Before it, this
    // same failure left a settlement balance recorded that never existed, and
    // the asset actually held recorded nowhere.
    expect((await harness.ledger.balance("PAYER_ASSET_HELD", "USDC")).balance).toEqual(DEPOSIT);
    expect(await harness.balance("MERCHANT_PAYABLE")).toEqual(money(0n, "IDRX"));
    expect(await harness.balance("TREASURY")).toEqual(money(0n, "IDRX"));
    assertEveryPostingBalances(harness);
  });
});
