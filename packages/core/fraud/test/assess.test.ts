import { describe, expect, test } from "bun:test";
import { FixedClock } from "@mayarin/shared";
import { RiskAssessor, type RiskFacts, type RiskRules } from "../src/index.ts";
import { InMemoryDenylist, InMemoryRiskHistory } from "../testing/index.ts";

const NOW = new Date("2026-10-19T00:00:00.000Z");
const PAYER = "0x000000000000000000000000000000000000CAFE";

const facts = (over: Partial<RiskFacts> = {}): RiskFacts => ({
  merchantId: "mrc_1",
  paymentIntentId: "pi_1",
  payer: PAYER,
  amount: 5_000_000n,
  asset: "USDC",
  ...over,
});

function setup(rules: Partial<RiskRules> = {}) {
  const history = new InMemoryRiskHistory();
  const denylist = new InMemoryDenylist();
  const assessor = new RiskAssessor({
    rules: async () => ({ windowSeconds: 3_600, ...rules }),
    history,
    denylist,
    clock: new FixedClock(NOW),
  });
  return { assessor, history, denylist };
}

describe("RiskAssessor", () => {
  test("clear when no rule is set and nothing is listed", async () => {
    const { assessor } = setup();
    const result = await assessor.assess(facts());
    expect(result).toMatchObject({ outcome: "CLEAR", signals: [], assessedAt: NOW });
  });

  test("a denylisted address is blocked, whatever its case", async () => {
    const { assessor, denylist } = setup();
    denylist.add(PAYER.toUpperCase());
    const result = await assessor.assess(facts({ payer: PAYER.toLowerCase() }));
    expect(result.outcome).toBe("BLOCKED");
    expect(result.signals[0]?.rule).toBe("denylist");
  });

  test("a path with no payer address skips the payer rules, not the merchant rules", async () => {
    const { assessor, history } = setup({ payerAttempts: 1, merchantAttempts: 2 });
    history.merchant.set("mrc_1", 2);
    const { payer: _unused, ...noPayer } = facts();
    const result = await assessor.assess(noPayer);
    expect(result.signals.map((s) => s.rule)).toEqual(["merchant-velocity"]);
  });

  test("velocity flags at the threshold, not below it, and only reviews", async () => {
    const { assessor, history } = setup({ payerAttempts: 3 });
    history.payer.set(PAYER.toLowerCase(), 2);
    expect((await assessor.assess(facts())).outcome).toBe("CLEAR");
    history.payer.set(PAYER.toLowerCase(), 3);
    const flagged = await assessor.assess(facts());
    expect(flagged.outcome).toBe("REVIEW");
    expect(flagged.signals[0]?.rule).toBe("payer-velocity");
  });

  test("an amount spike needs enough history behind it", async () => {
    const { assessor, history } = setup({ spikeFactor: 5, spikeMinHistory: 3 });
    history.paid.set("mrc_1:USDC", { count: 2, largest: 1_000_000n });
    expect((await assessor.assess(facts({ amount: 9_000_000n }))).outcome).toBe("CLEAR");

    history.paid.set("mrc_1:USDC", { count: 3, largest: 1_000_000n });
    const result = await assessor.assess(facts({ amount: 5_000_001n }));
    expect(result.outcome).toBe("REVIEW");
    expect(result.signals[0]?.rule).toBe("amount-spike");
    // Exactly five times is not over five times.
    expect((await assessor.assess(facts({ amount: 5_000_000n }))).outcome).toBe("CLEAR");
  });

  test("a block outranks a review", async () => {
    const { assessor, history, denylist } = setup({ payerAttempts: 1 });
    denylist.add(PAYER);
    history.payer.set(PAYER.toLowerCase(), 5);
    const result = await assessor.assess(facts());
    expect(result.outcome).toBe("BLOCKED");
    expect(result.signals.map((s) => s.rule).sort()).toEqual(["denylist", "payer-velocity"]);
  });
});
