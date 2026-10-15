import { describe, expect, test } from "bun:test";
import type { PaymentFunding } from "@mayarin/db";
import type { OrderState, TransfiClient } from "@mayarin/provider-transfi";
import { FixedClock, fromDecimalString } from "@mayarin/shared";
import { FiatSettler } from "../src/services/fiat-settler.ts";

const START = new Date("2026-10-13T12:00:00Z");

function funding(overrides: Partial<PaymentFunding> = {}): PaymentFunding {
  return {
    orderId: "OR-1",
    paymentIntentId: "pi_1",
    merchantId: "m_1",
    kind: "local-currency",
    provider: "transfi",
    paymentCode: "qris",
    paymentName: "QRIS",
    paymentLogoUrl: null,
    fiatCurrency: "IDR",
    fiatAmount: "104951.00",
    status: "initiated",
    settledAt: null,
    createdAt: START,
    ...overrides,
  };
}

function setup(options: {
  readonly order?: OrderState;
  readonly funding?: PaymentFunding;
  readonly deposit?: { chain: string; asset: string; amount: string } | null;
  readonly fund?: boolean;
}) {
  const clock = new FixedClock(START);
  const rows = [options.funding ?? funding()];
  const calls = {
    simulated: [] as string[],
    received: [] as string[],
    updates: [] as string[],
    funded: [] as string[],
  };
  let order: OrderState = options.order ?? {
    status: "fund_processing",
    destinationCurrency: "USDC",
    destinationAmount: 5.655218,
  };

  const transfi = {
    async getOrder() {
      return order;
    },
    async simulateSettled(orderId: string) {
      calls.simulated.push(orderId);
      order = { ...order, status: "asset_settled" };
    },
  } as unknown as TransfiClient;

  const deposit =
    options.deposit === undefined
      ? { chain: "ethereum-sepolia", asset: "USDC", amount: "5.585507" }
      : options.deposit;

  const settler = new FiatSettler({
    fundings: {
      async record() {},
      async listByPayment() {
        return rows;
      },
      async latestByPayments() {
        return new Map();
      },
      async listOpen() {
        return rows.filter((row) => row.settledAt === null);
      },
      async update(orderId, change) {
        calls.updates.push(`${orderId}:${change.status}`);
        const index = rows.findIndex((row) => row.orderId === orderId);
        const current = rows[index];
        if (current !== undefined) {
          rows[index] = { ...current, status: change.status, settledAt: change.settledAt ?? null };
        }
      },
    },
    transfi,
    payments: {
      async getPayment() {
        return {
          transaction:
            deposit === null
              ? null
              : {
                  id: "clr_1",
                  deposit: {
                    chain: deposit.chain,
                    asset: deposit.asset,
                    address: "0xdeposit",
                    amount: fromDecimalString(deposit.amount, "USDC"),
                  },
                },
        };
      },
    },
    engine: {
      async recordAssetReceived(id: string) {
        calls.received.push(id);
      },
    },
    ...(options.fund === true
      ? {
          async fund(deposit: { readonly address: string }) {
            calls.funded.push(deposit.address);
          },
        }
      : {}),
    clock,
  });

  return { settler, clock, calls, rows };
}

describe("FiatSettler", () => {
  test("leaves a fresh order alone so its QR can be seen", async () => {
    const { settler, calls } = setup({});

    await settler.tick();

    expect(calls.simulated).toEqual([]);
    expect(calls.received).toEqual([]);
  });

  test("marks an order paid a few seconds after it opens, then records the receipt", async () => {
    const { settler, clock, calls } = setup({});

    clock.advance(9_000);
    await settler.tick();
    expect(calls.simulated).toEqual(["OR-1"]);
    expect(calls.received).toEqual([]);

    // The sandbox now reports it delivered; the next pass is what funds the payment.
    const recorded = await settler.tick();
    expect(recorded).toEqual(["pi_1"]);
    expect(calls.received).toEqual(["clr_1"]);
  });

  test("marks an order paid once, however long the sandbox takes to apply it", async () => {
    const { settler, clock, calls } = setup({});

    clock.advance(9_000);
    await settler.tick();
    await settler.tick();
    await settler.tick();

    // `simulateSettled` flips the fake to settled, so a second ask would also be
    // visible as a receipt; one simulate is the point.
    expect(calls.simulated).toEqual(["OR-1"]);
  });

  test("does not fund a payment from an order that delivered a different token", async () => {
    const { settler, clock, calls } = setup({
      order: { status: "asset_settled", destinationCurrency: "USDCBASE", destinationAmount: 5.66 },
    });

    clock.advance(9_000);
    await settler.tick();

    expect(calls.received).toEqual([]);
  });

  test("does not fund a payment from an order that delivered too little", async () => {
    const { settler, clock, calls } = setup({
      order: { status: "asset_settled", destinationCurrency: "USDC", destinationAmount: 1 },
    });

    clock.advance(9_000);
    await settler.tick();

    expect(calls.received).toEqual([]);
  });

  test("does not fund a payment from an order that delivered far more", async () => {
    const { settler, clock, calls } = setup({
      order: { status: "asset_settled", destinationCurrency: "USDC", destinationAmount: 500 },
    });

    clock.advance(9_000);
    await settler.tick();

    expect(calls.received).toEqual([]);
  });

  test("records nothing for a payment that has no deposit address yet", async () => {
    const { settler, clock, calls } = setup({
      deposit: null,
      order: { status: "asset_settled", destinationCurrency: "USDC", destinationAmount: 5.66 },
    });

    clock.advance(9_000);
    await settler.tick();

    expect(calls.received).toEqual([]);
  });

  test("puts the delivered amount on the deposit address before recording the receipt", async () => {
    const { settler, clock, calls } = setup({
      fund: true,
      order: { status: "asset_settled", destinationCurrency: "USDC", destinationAmount: 5.66 },
    });

    clock.advance(9_000);
    await settler.tick();

    expect(calls.funded).toEqual(["0xdeposit"]);
    expect(calls.received).toEqual(["clr_1"]);
  });

  test("a payment is not funded when the order does not match it", async () => {
    const { settler, clock, calls } = setup({
      fund: true,
      order: { status: "asset_settled", destinationCurrency: "USDC", destinationAmount: 1 },
    });

    clock.advance(9_000);
    await settler.tick();

    expect(calls.funded).toEqual([]);
  });

  test("a settled order is not looked at again", async () => {
    const { settler, clock, calls } = setup({
      order: { status: "asset_settled", destinationCurrency: "USDC", destinationAmount: 5.66 },
    });

    clock.advance(9_000);
    await settler.tick();
    await settler.tick();

    expect(calls.received).toEqual(["clr_1"]);
  });
});
