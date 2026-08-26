import { describe, expect, test } from "bun:test";
import { assertBalanced } from "@mayarin/ledger";
import { SettlementAdapterRegistry } from "@mayarin/settlement";
import { money, ProviderError } from "@mayarin/shared";
import type { ContractLock } from "../src/contract-path.ts";
import { ClearingEngine } from "../src/engine.ts";
import { BasisPointsFeePolicy } from "../src/fees.ts";
import { StaticRateProvider } from "../src/rate.ts";
import type { ExecutionResult, TreasuryExecutionPort } from "../src/treasury.ts";
import { FakeContractPlanner } from "../testing/index.ts";
import { createHarness, NOW } from "./harness.ts";

/**
 * The deposit path when a treasury executor is wired (#81).
 *
 * The payment is priced once, by the planner, which also signs the order. The
 * lock's `payerEstimate` becomes the deposit amount, so the payer sends a
 * slippage-grossed figure, the swap clears `minOut`, and the excess goes to
 * `refundTo` — the treasury — where `FX_RESULT` books it.
 */

const TREASURY = "0x0000000000000000000000000000000000007a5b";
const GAS = money(594_366_000_000n, "ETH");
/** Grossed above what 50,000.00 USDC needs, so a normal fill leaves change. */
const PAYER_ESTIMATE = money(8_400_000_000_000_000n, "ETH");

function depositLock(): ContractLock {
  const lockedAt = new Date(NOW);
  const expiresAt = new Date(lockedAt.getTime() + 120_000);
  return {
    settlementAmount: money(5_000_000n, "USDC"),
    fee: money(25_000n, "USDC"),
    rate: {
      from: "ETH",
      to: "USDC",
      scaledRate: 60_000_000_00n,
      source: "uniswap",
      lockedAt,
    },
    payerEstimate: PAYER_ESTIMATE,
    expiresAt,
    order: {
      intentId: `0x${"11".repeat(32)}`,
      settlementToken: "0x000000000000000000000000000000000000c0de",
      minOut: 5_000_000n,
      fee: 25_000n,
      merchantSafe: "0x000000000000000000000000000000000000bEEF",
      // The engine passes the treasury as `payerAddress`; the planner signs it
      // into `refundTo`. Pinned here so a regression in that wiring is visible.
      refundTo: TREASURY,
      deadline: BigInt(Math.floor(expiresAt.getTime() / 1_000)),
      signature: `0x${"ab".repeat(65)}`,
      signer: "0x00000000000000000000000000000000000000a1",
    },
  };
}

function executingPort(output = money(5_000_000n, "USDC")): TreasuryExecutionPort & {
  results: ExecutionResult[];
} {
  const results: ExecutionResult[] = [];
  return {
    results,
    async sweep() {},
    async execute() {
      const result = { txHash: `0x${"fe".repeat(32)}`, output, gasCost: GAS };
      results.push(result);
      return result;
    },
  };
}

function executableHarness(port: TreasuryExecutionPort, lock: ContractLock = depositLock()) {
  const planner = new FakeContractPlanner(lock);
  const harness = createHarness({
    contractPlanner: planner,
    treasuryPort: port,
    treasuryAddress: TREASURY,
  });

  async function depositIntent() {
    return harness.confirmedIntent({ payment: { asset: "ETH", chain: "base-sepolia" } });
  }

  return { harness, planner, depositIntent };
}

function assertEveryPostingBalances(harness: ReturnType<typeof createHarness>) {
  const entries = harness.repositories.ledger.entries();
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

describe("locking a deposit that will be executed", () => {
  test("prices through the planner and signs an order, rather than quoting twice", async () => {
    const { harness, planner, depositIntent } = executableHarness(executingPort());

    const intent = await depositIntent();
    const transaction = await harness.engine.start(intent);

    expect(planner.calls).toHaveLength(1);
    // One pricing pass. The RateProvider is not consulted for this payment, so
    // there is no second price that could disagree with the signed order.
    expect(transaction.contract?.order.minOut).toBe(5_000_000n);
    expect(transaction.settlementAmount).toEqual(money(5_000_000n, "USDC"));
    expect(planner.calls[0]?.orderExpiresAt).toEqual(new Date(intent.expiresAt.getTime() + 60_000));
  });

  test("signs refundTo to the treasury, since the payer has no address here", async () => {
    const { harness, planner, depositIntent } = executableHarness(executingPort());

    const transaction = await harness.engine.start(await depositIntent());

    expect(planner.calls[0]?.payerAddress).toBe(TREASURY);
    expect(planner.calls[0]?.submission).toBe("relayer");
    expect(transaction.contract?.order.refundTo).toBe(TREASURY);
  });

  test("the deposit amount is the grossed payer estimate, not the settlement amount", async () => {
    const { harness, depositIntent } = executableHarness(executingPort());

    const transaction = await harness.engine.start(await depositIntent());

    // What the payer must send. Grossed by slippage so a normal fill clears
    // `minOut`; the excess is what `refundTo` receives.
    expect(transaction.deposit?.amount).toEqual(PAYER_ESTIMATE);
    expect(transaction.deposit?.asset).toBe("ETH");
    expect(transaction.deposit?.address).toBeDefined();
  });

  test("rounds a payer estimate up to the asset's payable precision", async () => {
    const lock = {
      ...depositLock(),
      payerEstimate: money(5_017_663_781_602_422n, "ETH"),
    };
    const { harness, depositIntent } = executableHarness(executingPort(), lock);

    const transaction = await harness.engine.start(await depositIntent());

    expect(transaction.deposit?.amount).toEqual(money(5_017_670_000_000_000n, "ETH"));
    expect(transaction.contract?.payerEstimate).toEqual(money(5_017_670_000_000_000n, "ETH"));
  });

  test("settles end to end, with the executor submitting the persisted order", async () => {
    const port = executingPort();
    const { harness, depositIntent } = executableHarness(port);

    const transaction = await harness.engine.start(await depositIntent());

    expect(transaction.state).toBe("SUCCESS");
    expect(port.results).toHaveLength(1);
    assertEveryPostingBalances(harness);
  });

  test("a swap above minOut books the excess as Mayarin's, not the merchant's", async () => {
    const port = executingPort(money(5_080_000n, "USDC"));
    const { harness, depositIntent } = executableHarness(port);

    await harness.engine.start(await depositIntent());

    expect(await harness.balance("FX_RESULT")).toEqual(money(80_000n, "USDC"));
    expect(await harness.balance("FEE_REVENUE")).toEqual(money(25_000n, "USDC"));
    assertEveryPostingBalances(harness);
  });

  test("the payer asset nets out once converted", async () => {
    const { harness, depositIntent } = executableHarness(executingPort());

    await harness.engine.start(await depositIntent());

    expect((await harness.ledger.balance("PAYER_ASSET_HELD", "ETH")).balance).toEqual(
      money(0n, "ETH"),
    );
    expect((await harness.ledger.balance("GAS_EXPENSE", "ETH")).balance).toEqual(GAS);
  });
});

describe("the indexer's log for an executed deposit", () => {
  /**
   * The router emits `PaymentCompleted` for this path too — the treasury
   * executor is what submitted the order. The engine made that call itself and
   * recorded what came back, so the log is an echo of settled work. Refusing it
   * left the settlement unmarked, and the indexer re-read the same log every
   * pass: one payment turning into an error every tick, forever.
   */
  test("is a no-op rather than a refusal, since the engine already recorded it", async () => {
    const { harness, depositIntent } = executableHarness(executingPort());
    const settled = await harness.engine.start(await depositIntent());

    const { transaction } = await harness.engine.recordPaymentCompleted(settled.id, {
      txHash: `0x${"fe".repeat(32)}`,
      settledAmount: settled.netAmount?.amount ?? 0n,
      fee: settled.fee?.amount ?? 0n,
      refundAmount: 0n,
    });

    expect(transaction.state).toBe("SUCCESS");
    expect(transaction.version).toBe(settled.version);
  });
});

describe("a terminal router failure", () => {
  test("keeps the decoded revert in the state.failed event payload", async () => {
    const port: TreasuryExecutionPort = {
      async sweep() {},
      async execute() {
        throw new ProviderError(
          "Transaction reverted with ExpiredOrder",
          { revert: "ExpiredOrder" },
          { retryable: false },
        );
      },
    };
    const { harness, depositIntent } = executableHarness(port);

    const transaction = await harness.engine.start(await depositIntent());
    const failed = (await harness.engine.history(transaction.id)).find(
      (event) => event.type === "state.failed",
    );

    expect(transaction.state).toBe("FAILED");
    expect(failed?.payload).toMatchObject({
      code: "PROVIDER_ERROR",
      revert: "ExpiredOrder",
    });
  });
});

describe("a signed order reaching a process without an executor", () => {
  /**
   * Two processes can share one database with different wiring — the incident
   * behind #104 was an e2e run racing a dev API that had no executor, and the
   * dev API settled the payment internally while the deposit sat unswept. The
   * lock promised on-chain settlement, so a process that cannot keep the
   * promise must park the payment, not improvise a different settlement.
   */
  test("parks in ASSET_RECEIVED, and a process with an executor completes it", async () => {
    const port = executingPort();
    const planner = new FakeContractPlanner(depositLock());
    const harness = createHarness({
      contractPlanner: planner,
      treasuryPort: port,
      treasuryAddress: TREASURY,
      autoConfirmAssetReceipt: false,
    });
    // The dev API of the incident: same repositories, no executor.
    const driverless = new ClearingEngine({
      repository: harness.repositories.clearing,
      intents: harness.intents,
      ledger: harness.ledger,
      adapters: new SettlementAdapterRegistry([harness.adapter]),
      rates: new StaticRateProvider({ "IDR/USDC": 100n }),
      fees: new BasisPointsFeePolicy(50),
      clock: harness.clock,
    });

    const locked = await harness.engine.start(
      await harness.confirmedIntent({ payment: { asset: "ETH", chain: "base-sepolia" } }),
    );
    expect(locked.state).toBe("PAYMENT_PENDING");

    await expect(driverless.recordAssetReceived(locked.id)).rejects.toBeInstanceOf(ProviderError);

    // The receipt was booked on the scheme the lock decided — the payer asset
    // is held, nothing was paid out — and the parked state is durable.
    const parked = await driverless.getById(locked.id);
    expect(parked.state).toBe("ASSET_RECEIVED");
    expect((await harness.ledger.balance("PAYER_ASSET_HELD", "ETH")).balance).toEqual(
      PAYER_ESTIMATE,
    );

    const resumed = await harness.engine.resume(locked.id);
    expect(resumed.transaction.state).toBe("SUCCESS");
    expect(port.results).toHaveLength(1);
    assertEveryPostingBalances(harness);
  });
});

describe("without an executor the deposit path is untouched", () => {
  test("an API with planning authority persists the order for a separate worker", async () => {
    const planner = new FakeContractPlanner(depositLock());
    const harness = createHarness({
      contractPlanner: planner,
      treasuryAddress: TREASURY,
      autoConfirmAssetReceipt: false,
    });

    const transaction = await harness.engine.start(
      await harness.confirmedIntent({ payment: { asset: "ETH", chain: "base-sepolia" } }),
    );

    expect(planner.calls).toHaveLength(1);
    expect(transaction.contract?.order.refundTo).toBe(TREASURY);
    expect(transaction.state).toBe("PAYMENT_PENDING");
  });

  test("prices through the RateProvider and signs nothing", async () => {
    const planner = new FakeContractPlanner(depositLock());
    const harness = createHarness({
      contractPlanner: planner,
      rates: { "IDR/USDC": 100n, "IDR/ETH": 320n },
    });

    const transaction = await harness.engine.start(
      await harness.confirmedIntent({ payment: { asset: "ETH", chain: "base-sepolia" } }),
    );

    // A planner alone is not enough: without a treasury refund address the
    // order cannot be signed safely, so the original internal path stays.
    expect(planner.calls).toHaveLength(0);
    expect(transaction.contract).toBeUndefined();
    expect(transaction.state).toBe("SUCCESS");
    assertEveryPostingBalances(harness);
  });
});
