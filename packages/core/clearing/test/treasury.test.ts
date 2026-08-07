import { describe, expect, test } from "bun:test";
import { LedgerService } from "@mayarin/ledger";
import { InMemoryLedgerRepository } from "@mayarin/ledger/testing";
import { FixedClock, money, ProviderError, ValidationError } from "@mayarin/shared";
import {
  type ExecuteRequest,
  ExecutionExhaustedError,
  type ExecutionResult,
  type SweepRequest,
  type TreasuryExecutionPort,
  TreasuryExecutor,
} from "../src/treasury.ts";
import type { ClearingTransaction } from "../src/types.ts";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function depositTransaction(): ClearingTransaction {
  return {
    id: "clr_01J8Z3K4M5N6P7Q8R9S0T1U2V3",
    paymentIntentId: "pint_01J8Z3K4M5N6P7Q8R9S0T1U2V3",
    state: "ASSET_RECEIVED",
    merchant: { id: "M-1", name: "Warung Kopi", city: "Jakarta", countryCode: "ID" },
    sourceAmount: money(5_000_000n, "IDR"),
    settlementAsset: "USDC",
    provider: "stablecoin",
    settlementAmount: money(3_000_000n, "USDC"),
    fee: money(10_000n, "USDC"),
    netAmount: money(2_990_000n, "USDC"),
    executionPath: "deposit-match",
    deposit: {
      asset: "ETH",
      chain: "base-sepolia",
      address: "0x9ec7b9ccbd9feb765eb0da23c166f5006a0b2343",
      amount: money(1_050_000_000_000_000n, "ETH"),
      rate: {
        from: "IDR",
        to: "ETH",
        scaledRate: 2_857_142_857n,
        source: "test",
        lockedAt: NOW,
      },
    },
    contract: {
      order: {
        intentId: "0xabc",
        settlementToken: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        minOut: 3_000_000n,
        fee: 10_000n,
        merchantSafe: "0x0000000000000000000000000000000000000001",
        refundTo: "0x0000000000000000000000000000000000000002",
        deadline: 1_800_000_000n,
        signature: "0xsig",
        signer: "0x44485BE1a62C5Ca083dD04505eAB05Fb998F0Bda",
      },
      payerEstimate: money(1_050_000_000_000_000n, "ETH"),
      expiresAt: NOW,
    },
    createdAt: NOW,
    updatedAt: NOW,
    version: 4,
  };
}

interface Recorded {
  readonly sweeps: SweepRequest[];
  readonly executions: ExecuteRequest[];
}

function fakePort(
  behaviour: (request: ExecuteRequest) => Promise<ExecutionResult>,
): TreasuryExecutionPort & { recorded: Recorded } {
  const recorded: Recorded = { sweeps: [], executions: [] };

  return {
    recorded,
    async sweep(request) {
      recorded.sweeps.push(request);
    },
    async execute(request) {
      recorded.executions.push(request);
      return behaviour(request);
    },
  };
}

function ledger() {
  const repository = new InMemoryLedgerRepository(new FixedClock(NOW));
  const service = new LedgerService({ repository, clock: new FixedClock(NOW) });
  return { service, repository };
}

const SUCCESS: ExecutionResult = {
  txHash: "0xdeadbeef",
  output: money(3_080_000n, "USDC"),
  gasCost: money(594_366_000_000n, "ETH"),
};

describe("TreasuryExecutor", () => {
  test("sweeps the deposit, submits, and reports what actually came out", async () => {
    const port = fakePort(async () => SUCCESS);
    const executor = new TreasuryExecutor({ port, ledger: ledger().service });

    const result = await executor.execute(depositTransaction());

    expect(result.txHash).toBe("0xdeadbeef");
    expect(result.output).toEqual(money(3_080_000n, "USDC"));
    expect(port.recorded.sweeps).toEqual([
      {
        clearingTransactionId: "clr_01J8Z3K4M5N6P7Q8R9S0T1U2V3",
        chain: "base-sepolia",
        depositAddress: "0x9ec7b9ccbd9feb765eb0da23c166f5006a0b2343",
        asset: "ETH",
      },
    ]);
  });

  test("reuses the signed order verbatim and never re-signs it", async () => {
    const port = fakePort(async () => SUCCESS);
    await new TreasuryExecutor({ port, ledger: ledger().service }).execute(depositTransaction());

    // Acceptance criterion: a resumed step reuses the order. The executor has no
    // signer at all, so re-signing is not merely avoided — it is impossible.
    expect(port.recorded.executions[0]?.order).toEqual(depositTransaction().contract?.order);
  });

  test("books the swap and the gas against what happened, not the quote", async () => {
    const { service, repository } = ledger();
    const port = fakePort(async () => SUCCESS);

    await new TreasuryExecutor({ port, ledger: service }).execute(depositTransaction());

    const swap = await repository.findTransactionByIdempotencyKey(
      "clr_01J8Z3K4M5N6P7Q8R9S0T1U2V3:SWAPPED",
    );
    const gas = await repository.findTransactionByIdempotencyKey(
      "clr_01J8Z3K4M5N6P7Q8R9S0T1U2V3:GAS",
    );

    expect(swap).not.toBeNull();
    expect(gas).not.toBeNull();
    // Output beat the 3.00 lock by 0.08, so FX_RESULT takes the difference.
    expect(swap?.entries.some((e) => e.accountCode === "FX_RESULT:USDC")).toBe(true);
  });

  // ------------------------------------------------------------------
  // minOut failure: a decided, bounded outcome
  // ------------------------------------------------------------------

  test("retries a retryable failure with a fresh attempt number", async () => {
    let calls = 0;
    const port = fakePort(async () => {
      calls += 1;
      if (calls < 3) throw new ProviderError("route went stale", {}, { retryable: true });
      return SUCCESS;
    });

    const result = await new TreasuryExecutor({ port, ledger: ledger().service }).execute(
      depositTransaction(),
    );

    expect(result.txHash).toBe("0xdeadbeef");
    // The attempt number is passed through so the adapter refetches a route
    // rather than resubmitting the one that just missed.
    expect(port.recorded.executions.map((e) => e.attempt)).toEqual([1, 2, 3]);
  });

  test("gives up after the attempt bound rather than retrying forever", async () => {
    const port = fakePort(async () => {
      throw new ProviderError("minOut not met", {}, { retryable: true });
    });
    const executor = new TreasuryExecutor({ port, ledger: ledger().service, maxAttempts: 2 });

    await expect(executor.execute(depositTransaction())).rejects.toThrow(ExecutionExhaustedError);
    expect(port.recorded.executions).toHaveLength(2);
  });

  test("exhaustion is terminal, so the engine fails the payment instead of looping", async () => {
    const port = fakePort(async () => {
      throw new ProviderError("minOut not met", {}, { retryable: true });
    });

    try {
      await new TreasuryExecutor({ port, ledger: ledger().service, maxAttempts: 1 }).execute(
        depositTransaction(),
      );
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ExecutionExhaustedError);
      expect((error as ExecutionExhaustedError).retryable).toBe(false);
      // The reasons are carried so the failure says why, not just that.
      expect((error as ExecutionExhaustedError).details.failures).toEqual(["minOut not met"]);
    }
  });

  test("a non-retryable failure is not retried at all", async () => {
    const port = fakePort(async () => {
      throw new ValidationError("order already consumed");
    });

    await expect(
      new TreasuryExecutor({ port, ledger: ledger().service }).execute(depositTransaction()),
    ).rejects.toThrow(ValidationError);
    expect(port.recorded.executions).toHaveLength(1);
  });

  test("nothing is booked when execution never succeeded", async () => {
    const { service, repository } = ledger();
    const port = fakePort(async () => {
      throw new ProviderError("minOut not met", {}, { retryable: true });
    });

    await expect(
      new TreasuryExecutor({ port, ledger: service, maxAttempts: 1 }).execute(depositTransaction()),
    ).rejects.toThrow(ExecutionExhaustedError);

    // The payer's asset stays in PAYER_ASSET_HELD from the receipt posting —
    // visible and unconverted, which is exactly what RFC #70 exists to make
    // representable. Booking a swap that did not happen would hide it.
    expect(
      await repository.findTransactionByIdempotencyKey("clr_01J8Z3K4M5N6P7Q8R9S0T1U2V3:SWAPPED"),
    ).toBeNull();
  });

  // ------------------------------------------------------------------
  // Guards
  // ------------------------------------------------------------------

  test("refuses a transaction with no deposit", async () => {
    const { deposit: _deposit, ...rest } = depositTransaction();
    void _deposit;

    await expect(
      new TreasuryExecutor({
        port: fakePort(async () => SUCCESS),
        ledger: ledger().service,
      }).execute(rest),
    ).rejects.toThrow(ExecutionExhaustedError);
  });

  test("refuses a transaction with no signed order", async () => {
    const { contract: _contract, ...rest } = depositTransaction();
    void _contract;

    await expect(
      new TreasuryExecutor({
        port: fakePort(async () => SUCCESS),
        ledger: ledger().service,
      }).execute(rest),
    ).rejects.toThrow(ExecutionExhaustedError);
  });

  test("sweeps before submitting, so the operator holds the funds it is about to spend", async () => {
    const order: string[] = [];
    const port: TreasuryExecutionPort = {
      async sweep() {
        order.push("sweep");
      },
      async execute() {
        order.push("execute");
        return SUCCESS;
      },
    };

    await new TreasuryExecutor({ port, ledger: ledger().service }).execute(depositTransaction());

    expect(order).toEqual(["sweep", "execute"]);
  });
});
