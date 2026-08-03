import { describe, expect, test } from "bun:test";
import { FixedClock, money } from "@mayarin/shared";
import { StablecoinSettlementAdapter } from "../src/adapter.ts";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const clock = new FixedClock(NOW);

const request = {
  clearingTransactionId: "clr_01J8Z3K4M5N6P7Q8R9S0T1U2V3",
  paymentIntentId: "pint_01J8Z3K4M5N6P7Q8R9S0T1U2V3",
  merchant: { id: "M-1", name: "Warung Kopi", city: "Jakarta", countryCode: "ID" },
  amount: money(4_975_000n, "USDC"),
  idempotencyKey: "clr_01J8Z3K4M5N6P7Q8R9S0T1U2V3:settle",
  metadata: {},
};

describe("StablecoinSettlementAdapter", () => {
  test("is the internal stablecoin rail", () => {
    const adapter = new StablecoinSettlementAdapter({ clock });
    expect(adapter.name).toBe("stablecoin");
    expect(adapter.mode).toBe("internal");
  });

  test("settles synchronously and successfully", async () => {
    const adapter = new StablecoinSettlementAdapter({ clock });
    const result = await adapter.settle(request);
    expect(result.state).toBe("SUCCEEDED");
    expect(result.providerReference).toMatch(/^stl_/);
    expect(result.settledAt).toEqual(NOW);
  });

  test("is idempotent — a replayed key returns the same reference", async () => {
    const adapter = new StablecoinSettlementAdapter({ clock });
    const first = await adapter.settle(request);
    const second = await adapter.settle(request);
    expect(second.providerReference).toBe(first.providerReference);
  });

  test("status reports the recorded settlement", async () => {
    const adapter = new StablecoinSettlementAdapter({ clock });
    const result = await adapter.settle(request);
    const status = await adapter.status(result.providerReference);
    expect(status.state).toBe("SUCCEEDED");
    expect(status.amount).toEqual(money(4_975_000n, "USDC"));
  });

  test("refund transitions a succeeded settlement to REFUNDED", async () => {
    const adapter = new StablecoinSettlementAdapter({ clock });
    const result = await adapter.settle(request);
    const refund = await adapter.refund({
      providerReference: result.providerReference,
      idempotencyKey: `${result.providerReference}:refund`,
    });
    expect(refund.state).toBe("REFUNDED");
    expect((await adapter.status(result.providerReference)).state).toBe("REFUNDED");
  });

  test("webhook returns null — an internal rail has no external events", async () => {
    const adapter = new StablecoinSettlementAdapter({ clock });
    expect(await adapter.webhook({ headers: {}, rawBody: "" })).toBeNull();
  });
});
