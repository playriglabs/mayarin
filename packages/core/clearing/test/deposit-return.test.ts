import { describe, expect, test } from "bun:test";
import { money, ProviderError } from "@mayarin/shared";
import type { ContractLock } from "../src/contract-path.ts";
import {
  type DepositReturnPort,
  type DepositReturnReceipt,
  type DepositReturnRequest,
  DepositReturnService,
} from "../src/deposit-return.ts";
import type { TreasuryExecutionPort } from "../src/treasury.ts";
import { FakeContractPlanner } from "../testing/index.ts";
import { createHarness, NOW } from "./harness.ts";

/**
 * A deposit-match payment that fails after the payer's asset arrived is sent
 * back, but only to an address the payer named, only after the grace period,
 * and never twice.
 */

const TREASURY = "0x0000000000000000000000000000000000007a5b";
const PAYER = "0x00000000000000000000000000000000000000a2";
const DEPOSIT = money(8_400_000_000_000_000n, "ETH");
const GRACE_SECONDS = 3_600;

function lock(): ContractLock {
  const lockedAt = new Date(NOW);
  const expiresAt = new Date(lockedAt.getTime() + 120_000);
  return {
    settlementAmount: money(5_000_000n, "USDC"),
    fee: money(25_000n, "USDC"),
    rate: { from: "ETH", to: "USDC", scaledRate: 6_000_000_000n, source: "uniswap", lockedAt },
    payerEstimate: DEPOSIT,
    expiresAt,
    order: {
      intentId: `0x${"11".repeat(32)}`,
      settlementToken: "0x000000000000000000000000000000000000c0de",
      minOut: 5_000_000n,
      fee: 25_000n,
      merchantSafe: "0x000000000000000000000000000000000000bEEF",
      refundTo: TREASURY,
      deadline: BigInt(Math.floor(expiresAt.getTime() / 1_000)),
      signature: `0x${"ab".repeat(65)}`,
      signer: "0x00000000000000000000000000000000000000a1",
    },
  };
}

/** The router refuses the order for good, so the payment fails with the deposit unmoved. */
const failingExecution: TreasuryExecutionPort = {
  async sweep() {
    return undefined;
  },
  async execute() {
    throw new ProviderError("ExpiredOrder", {}, { retryable: false });
  },
};

class FakeReturnPort implements DepositReturnPort {
  readonly prepared: DepositReturnRequest[] = [];
  readonly sent: DepositReturnRequest[] = [];
  receiptStatus: DepositReturnReceipt = { status: "success", gasCost: money(1_000n, "ETH") };
  prepareError: Error | undefined;
  sendError: Error | undefined;

  supports(): boolean {
    return true;
  }
  async prepare(request: DepositReturnRequest) {
    if (this.prepareError !== undefined) throw this.prepareError;
    this.prepared.push(request);
    return { txHash: `0x${"5e".repeat(32)}`, gasCost: money(500n, "ETH") };
  }
  async send(request: DepositReturnRequest) {
    if (this.sendError !== undefined) throw this.sendError;
    this.sent.push(request);
    return `0x${"ee".repeat(32)}`;
  }
  async receipt(): Promise<DepositReturnReceipt> {
    return this.receiptStatus;
  }
}

async function failedDeposit(named = true) {
  const harness = createHarness({
    contractPlanner: new FakeContractPlanner(lock()),
    treasuryPort: failingExecution,
    treasuryAddress: TREASURY,
  });
  const intent = await harness.confirmedIntent({
    payment: {
      asset: "ETH",
      chain: "base-sepolia",
      ...(named ? { returnAddress: PAYER } : {}),
    },
  });
  const transaction = await harness.engine.start(intent);
  expect(transaction.state).toBe("FAILED");

  const port = new FakeReturnPort();
  const service = new DepositReturnService({
    repository: harness.repositories.clearing,
    intents: harness.intents,
    ledger: harness.ledger,
    port,
    clock: harness.clock,
    graceSeconds: GRACE_SECONDS,
  });
  const afterGrace = () => harness.clock.advance((GRACE_SECONDS + 1) * 1_000);
  return { harness, transaction, port, service, afterGrace };
}

const held = async (harness: Awaited<ReturnType<typeof failedDeposit>>["harness"]) =>
  (await harness.ledger.balance("PAYER_ASSET_HELD", "ETH")).balance;

describe("returning a failed deposit", () => {
  test("sends the exact deposit to the payer's address and clears the ledger", async () => {
    const { harness, transaction, port, service, afterGrace } = await failedDeposit();
    expect(await held(harness)).toEqual(DEPOSIT);

    afterGrace();
    const [result] = await service.returnPending();

    expect(result?.outcome).toBe("returned");
    expect(port.sent).toHaveLength(1);
    expect(port.sent[0]).toMatchObject({
      clearingTransactionId: transaction.id,
      to: PAYER,
      amount: DEPOSIT,
    });
    expect(await held(harness)).toEqual(money(0n, "ETH"));
    expect((await harness.ledger.balance("PAYER_ASSET_OBLIGATION", "ETH")).balance).toEqual(
      money(0n, "ETH"),
    );
  });

  test("books the sweep and the return transfer as gas", async () => {
    const { harness, service, afterGrace } = await failedDeposit();

    afterGrace();
    await service.returnPending();

    expect((await harness.ledger.balance("GAS_EXPENSE", "ETH")).balance).toEqual(
      money(1_500n, "ETH"),
    );
  });

  test("a returned payment is not listed again", async () => {
    const { port, service, afterGrace } = await failedDeposit();

    afterGrace();
    await service.returnPending();
    const again = await service.returnPending();

    expect(again).toEqual([]);
    expect(port.sent).toHaveLength(1);
  });

  test("waits out the grace period so a person can still retry", async () => {
    const { port, service } = await failedDeposit();

    expect(await service.returnPending()).toEqual([]);
    expect(port.sent).toHaveLength(0);
  });

  test("leaves a payment whose payer named no address", async () => {
    const { harness, port, service, afterGrace } = await failedDeposit(false);

    afterGrace();
    const [result] = await service.returnPending();

    expect(result?.outcome).toBe("no-address");
    expect(port.sent).toHaveLength(0);
    expect(await held(harness)).toEqual(DEPOSIT);
  });

  test("a transfer still pending is confirmed on the next pass without sending again", async () => {
    const { harness, port, service, afterGrace } = await failedDeposit();
    port.receiptStatus = { status: "pending" };

    afterGrace();
    expect((await service.returnPending())[0]?.outcome).toBe("pending");
    port.receiptStatus = { status: "success" };
    expect((await service.returnPending())[0]?.outcome).toBe("returned");

    expect(port.sent).toHaveLength(1);
    expect(await held(harness)).toEqual(money(0n, "ETH"));
  });

  test("a reverted transfer keeps the deposit on the books", async () => {
    const { harness, port, service, afterGrace } = await failedDeposit();
    port.receiptStatus = { status: "reverted" };

    afterGrace();
    const [result] = await service.returnPending();

    expect(result?.outcome).toBe("reverted");
    expect(await held(harness)).toEqual(DEPOSIT);
  });

  test("refuses when the guard before the send throws, and sends nothing", async () => {
    const { harness, port, service, afterGrace } = await failedDeposit();
    port.prepareError = new ProviderError("the router consumed the intent", {});

    afterGrace();
    const [result] = await service.returnPending();

    expect(result?.outcome).toBe("error");
    expect(port.sent).toHaveLength(0);
    expect(await held(harness)).toEqual(DEPOSIT);
  });

  test("a send that fails after the return started is never retried by itself", async () => {
    const { port, service, afterGrace } = await failedDeposit();
    port.sendError = new ProviderError("node timeout", {});

    afterGrace();
    expect((await service.returnPending())[0]?.outcome).toBe("error");
    port.sendError = undefined;
    const [second] = await service.returnPending();

    expect(second?.outcome).toBe("needs-review");
    expect(port.sent).toHaveLength(0);
  });

  test("a payment being returned cannot be retried into settlement", async () => {
    const { harness, transaction, service, afterGrace } = await failedDeposit();

    afterGrace();
    await service.returnPending();

    await expect(harness.engine.retry(transaction.id)).rejects.toThrow(/returned to the payer/);
  });
});
