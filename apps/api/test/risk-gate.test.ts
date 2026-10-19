import { describe, expect, test } from "bun:test";
import { RiskAssessor } from "@mayarin/fraud";
import { InMemoryDenylist, InMemoryRiskHistory } from "@mayarin/fraud/testing";
import type { MerchantEventSink } from "@mayarin/notifications";
import type { PaymentIntent } from "@mayarin/payment-intent";
import { FixedClock, money } from "@mayarin/shared";
import { RiskGateService } from "../src/services/risk-gate.ts";

const NOW = new Date("2026-10-19T00:00:00.000Z");
const PAYER = "0x000000000000000000000000000000000000cafe";

const intent = (payer?: string): PaymentIntent =>
  ({
    id: "pi_1",
    ownerMerchantId: "mrc_1",
    merchant: { id: "mrc_1" },
    amount: money(5_000_000n, "IDR"),
    ...(payer === undefined ? {} : { payment: { payerAddress: payer } }),
  }) as unknown as PaymentIntent;

function setup(rules = { windowSeconds: 3_600 } as Record<string, number>) {
  const history = new InMemoryRiskHistory();
  const denylist = new InMemoryDenylist();
  const recorded: { id: string; outcome: string }[] = [];
  const deliveries: { body: string }[] = [];
  const webhooks: MerchantEventSink = {
    endpoints: { listActiveByMerchant: async () => [{ id: "whe_1" }] as never },
    deliveries: {
      insertMany: async (rows) => {
        deliveries.push(...(rows as unknown as { body: string }[]));
        return rows.length;
      },
    },
  };
  const gate = new RiskGateService({
    assessor: new RiskAssessor({
      rules: async () => rules as never,
      history,
      denylist,
      clock: new FixedClock(NOW),
    }),
    assessments: { record: async (id, a) => void recorded.push({ id, outcome: a.outcome }) },
    webhooks,
    clock: new FixedClock(NOW),
  });
  return { gate, history, denylist, recorded, deliveries };
}

describe("RiskGateService", () => {
  test("a clear payment records nothing and sends nothing", async () => {
    const { gate, recorded, deliveries } = setup();
    expect(await gate.check(intent(PAYER))).toEqual({ blocked: false });
    expect(recorded).toEqual([]);
    expect(deliveries).toEqual([]);
  });

  test("a denylisted payer is blocked, recorded and announced", async () => {
    const { gate, denylist, recorded, deliveries } = setup();
    denylist.add(PAYER);
    expect(await gate.check(intent(PAYER))).toEqual({ blocked: true });
    expect(recorded.map((r) => r.outcome)).toEqual(["BLOCKED"]);
    const body = JSON.parse(deliveries[0]?.body ?? "{}");
    expect(body).toMatchObject({
      id: "pi_1:flagged",
      type: "payment.flagged",
      data: { paymentIntentId: "pi_1", outcome: "BLOCKED" },
    });
  });

  test("a review goes ahead, flagged", async () => {
    const { gate, history, recorded, deliveries } = setup({
      windowSeconds: 3_600,
      merchantAttempts: 2,
    });
    history.merchant.set("mrc_1", 2);
    expect(await gate.check(intent())).toEqual({ blocked: false });
    expect(recorded.map((r) => r.outcome)).toEqual(["REVIEW"]);
    expect(deliveries).toHaveLength(1);
  });

  test("fails open when the rules cannot be evaluated", async () => {
    const { gate, history } = setup({ windowSeconds: 3_600, merchantAttempts: 1 });
    history.merchantAttempts = async () => {
      throw new Error("database down");
    };
    expect(await gate.check(intent())).toEqual({ blocked: false });
  });
});
