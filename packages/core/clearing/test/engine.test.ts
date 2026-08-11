import { describe, expect, test } from "bun:test";
import { totalsByAsset } from "@mayarin/ledger";
import { MOCK_SIGNATURE_HEADER } from "@mayarin/provider-mock";
import { money, RATE_SCALE } from "@mayarin/shared";
import { createHarness } from "./harness.ts";

const IDRX = (minorUnits: bigint) => money(minorUnits, "IDRX");

describe("clearing engine — happy path", () => {
  test("walks every state from CREATED to SUCCESS", async () => {
    const harness = createHarness();
    const intent = await harness.confirmedIntent();

    const transaction = await harness.engine.start(intent);

    expect(transaction.state).toBe("SUCCESS");
    expect(transaction.paymentIntentId).toBe(intent.id);
    expect(await harness.intents.getById(intent.id)).toMatchObject({ status: "COMPLETED" });
  });

  test("locks the price and splits fee from net", async () => {
    const harness = createHarness({ feeBasisPoints: 50 });
    const transaction = await harness.engine.start(await harness.confirmedIntent());

    expect(transaction.settlementAmount).toEqual(IDRX(5_000_000n));
    expect(transaction.fee).toEqual(IDRX(25_000n));
    expect(transaction.netAmount).toEqual(IDRX(4_975_000n));
    expect(transaction.rate?.scaledRate).toBe(100n * RATE_SCALE);
  });

  test("records the full history in order", async () => {
    const harness = createHarness();
    const transaction = await harness.engine.start(await harness.confirmedIntent());
    const history = await harness.engine.history(transaction.id);

    expect(history.map((event) => event.toState)).toEqual([
      "CREATED",
      "QR_PARSED",
      "PRICE_LOCKED",
      "PAYMENT_PENDING",
      "ASSET_RECEIVED",
      "CLEARING",
      "SETTLING",
      "SETTLED",
      "SUCCESS",
    ]);
    expect(history.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test("leaves the ledger holding exactly the fee", async () => {
    const harness = createHarness({ feeBasisPoints: 50 });
    await harness.engine.start(await harness.confirmedIntent());

    expect(await harness.balance("TREASURY")).toEqual(IDRX(25_000n));
    expect(await harness.balance("FEE_REVENUE")).toEqual(IDRX(25_000n));
    expect(await harness.balance("MERCHANT_PAYABLE")).toEqual(IDRX(0n));
    expect(await harness.balance("SETTLEMENT_IN_FLIGHT")).toEqual(IDRX(0n));
    expect(await harness.balance("MERCHANT_HOLDING")).toEqual(IDRX(0n));
  });

  test("an internal settlement credits the merchant holding, not treasury", async () => {
    const harness = createHarness({ feeBasisPoints: 50, mode: "internal" });
    await harness.engine.start(await harness.confirmedIntent());

    // Treasury keeps the full settlement amount; the net is owed to the merchant
    // as a withdrawable holding, and the in-flight claim is extinguished.
    expect(await harness.balance("TREASURY")).toEqual(IDRX(5_000_000n));
    expect(await harness.balance("MERCHANT_HOLDING")).toEqual(IDRX(4_975_000n));
    expect(await harness.balance("FEE_REVENUE")).toEqual(IDRX(25_000n));
    expect(await harness.balance("MERCHANT_PAYABLE")).toEqual(IDRX(0n));
    expect(await harness.balance("SETTLEMENT_IN_FLIGHT")).toEqual(IDRX(0n));
  });

  test("keeps every posting balanced", async () => {
    const harness = createHarness();
    const transaction = await harness.engine.start(await harness.confirmedIntent());

    const postings = await harness.ledger.transactionsFor(transaction.id);
    expect(postings).toHaveLength(3);
    for (const posting of postings) {
      for (const { debits, credits } of totalsByAsset(posting.entries)) {
        expect(debits).toEqual(credits);
      }
    }
  });

  test("publishes an event for every transition", async () => {
    const harness = createHarness();
    await harness.engine.start(await harness.confirmedIntent());

    const clearingEvents = harness.published.filter((event) => event.type.startsWith("clearing."));
    expect(clearingEvents.map((event) => event.type)).toContain("clearing.success");
    expect(harness.published.map((event) => event.type)).toContain("payment_intent.completed");
  });
});

describe("clearing engine — idempotency", () => {
  test("starting twice reuses the same clearing transaction", async () => {
    const harness = createHarness();
    const intent = await harness.confirmedIntent();

    const first = await harness.engine.start(intent);
    const second = await harness.engine.start(intent);

    expect(second.id).toBe(first.id);
    expect(second.version).toBe(first.version);
    expect(await harness.ledger.transactionsFor(first.id)).toHaveLength(3);
  });

  test("resuming a settled payment changes nothing", async () => {
    const harness = createHarness();
    const transaction = await harness.engine.start(await harness.confirmedIntent());

    const resumed = await harness.engine.resume(transaction.id);

    expect(resumed.transaction.version).toBe(transaction.version);
    expect(resumed.waiting).toBe(false);
    expect(await harness.balance("TREASURY")).toEqual(IDRX(25_000n));
  });

  test("replaying a step does not post twice", async () => {
    const harness = createHarness({ autoConfirmAssetReceipt: false });
    const intent = await harness.confirmedIntent();
    const pending = await harness.engine.start(intent);
    expect(pending.state).toBe("PAYMENT_PENDING");

    await harness.engine.recordAssetReceived(pending.id);
    await harness.engine.recordAssetReceived(pending.id);
    await harness.engine.resume(pending.id);

    expect(await harness.ledger.transactionsFor(pending.id)).toHaveLength(3);
    expect(await harness.balance("TREASURY")).toEqual(IDRX(25_000n));
  });
});

describe("clearing engine — waiting for the outside world", () => {
  test("stops at PAYMENT_PENDING until the asset is confirmed", async () => {
    const harness = createHarness({ autoConfirmAssetReceipt: false });
    const transaction = await harness.engine.start(await harness.confirmedIntent());

    expect(transaction.state).toBe("PAYMENT_PENDING");
    expect(await harness.balance("TREASURY")).toEqual(IDRX(0n));

    const progressed = await harness.engine.recordAssetReceived(transaction.id);
    expect(progressed.transaction.state).toBe("SUCCESS");
  });

  test("stops at SETTLING until the provider confirms", async () => {
    const harness = createHarness({ behaviour: "pending" });
    const transaction = await harness.engine.start(await harness.confirmedIntent());

    expect(transaction.state).toBe("SETTLING");
    expect(transaction.providerReference).toBeDefined();
    // The merchant's claim has left payable and is visibly in flight.
    expect(await harness.balance("MERCHANT_PAYABLE")).toEqual(IDRX(0n));
    expect(await harness.balance("SETTLEMENT_IN_FLIGHT")).toEqual(IDRX(4_975_000n));
  });

  test("resumes once the provider settles", async () => {
    const harness = createHarness({ behaviour: "pending" });
    const settling = await harness.engine.start(await harness.confirmedIntent());

    harness.adapter.complete(settling.providerReference as string);
    const resumed = await harness.engine.resume(settling.id);

    expect(resumed.transaction.state).toBe("SUCCESS");
    expect(await harness.balance("SETTLEMENT_IN_FLIGHT")).toEqual(IDRX(0n));
    expect(await harness.balance("TREASURY")).toEqual(IDRX(25_000n));
  });

  test("resumeStuck picks up everything left mid-flight", async () => {
    const harness = createHarness({ behaviour: "pending" });
    const settling = await harness.engine.start(await harness.confirmedIntent());
    harness.adapter.complete(settling.providerReference as string);

    const [progress] = await harness.engine.resumeStuck();

    expect(progress?.transaction.state).toBe("SUCCESS");
    expect(await harness.engine.resumeStuck()).toHaveLength(0);
  });
});

describe("clearing engine — webhooks", () => {
  test("a provider webhook drives a pending settlement to SUCCESS", async () => {
    const secret = "whsec_mayarin_test";
    const harness = createHarness({ behaviour: "pending", webhookSecret: secret });
    const settling = await harness.engine.start(await harness.confirmedIntent());

    const rawBody = JSON.stringify({
      providerReference: settling.providerReference,
      state: "SUCCEEDED",
    });

    const progress = await harness.engine.handleSettlementWebhook("mock", {
      headers: { [MOCK_SIGNATURE_HEADER]: harness.adapter.sign(rawBody) },
      rawBody,
    });

    expect(progress?.transaction.state).toBe("SUCCESS");
  });

  test("rejects a webhook with a bad signature", async () => {
    const harness = createHarness({ behaviour: "pending", webhookSecret: "whsec_mayarin_test" });
    const settling = await harness.engine.start(await harness.confirmedIntent());
    const rawBody = JSON.stringify({
      providerReference: settling.providerReference,
      state: "SUCCEEDED",
    });

    await expect(
      harness.engine.handleSettlementWebhook("mock", {
        headers: { [MOCK_SIGNATURE_HEADER]: "deadbeef" },
        rawBody,
      }),
    ).rejects.toThrow(/signature/i);
  });

  test("ignores a webhook for an unknown settlement", async () => {
    const harness = createHarness({ behaviour: "pending" });
    await harness.engine.start(await harness.confirmedIntent());

    const result = await harness.engine.handleSettlementWebhook("mock", {
      headers: {},
      rawBody: JSON.stringify({ providerReference: "stl_unknown", state: "SUCCEEDED" }),
    });

    expect(result).toBeNull();
  });
});

describe("clearing engine — failure", () => {
  test("a declined settlement fails the transaction and the intent", async () => {
    const harness = createHarness({ behaviour: "fail" });
    const intent = await harness.confirmedIntent();

    const transaction = await harness.engine.start(intent);

    expect(transaction.state).toBe("FAILED");
    expect(transaction.failure?.code).toBe("PROVIDER_ERROR");
    expect(await harness.intents.getById(intent.id)).toMatchObject({ status: "FAILED" });
  });

  test("a failed settlement leaves the merchant's claim in flight, not silently cleared", async () => {
    const harness = createHarness({ behaviour: "fail" });
    await harness.engine.start(await harness.confirmedIntent());

    // Value received and cleared is still on the books; only the payout failed.
    expect(await harness.balance("SETTLEMENT_IN_FLIGHT")).toEqual(IDRX(4_975_000n));
    expect(await harness.balance("TREASURY")).toEqual(IDRX(5_000_000n));
  });

  test("failing is terminal and repeatable", async () => {
    const harness = createHarness({ behaviour: "fail" });
    const failed = await harness.engine.start(await harness.confirmedIntent());

    const again = await harness.engine.fail(failed.id, "second attempt");
    expect(again.version).toBe(failed.version);
    expect(again.failure?.reason).toBe(failed.failure?.reason);
  });

  test("refuses to clear an intent that was never confirmed", async () => {
    const harness = createHarness();
    const created = await harness.intents.create({
      merchant: { id: "M1", name: "Shop", city: "Jakarta", countryCode: "ID" },
      amount: money(1_000n, "IDR"),
      source: { type: "manual" },
    });

    await expect(harness.engine.start(created)).rejects.toThrow(/must be CONFIRMED/);
  });

  test("refuses a fee that would consume the whole payment", async () => {
    const harness = createHarness({ feeBasisPoints: 10_000 });
    const intent = await harness.confirmedIntent();

    const transaction = await harness.engine.start(intent);
    expect(transaction.state).toBe("FAILED");
    expect(transaction.failure?.reason).toMatch(/Fee consumes/);
  });
});

describe("clearing engine — expiry sweep", () => {
  test("fails a payment abandoned at PAYMENT_PENDING past its deadline", async () => {
    const harness = createHarness({ autoConfirmAssetReceipt: false });
    const transaction = await harness.engine.start(await harness.confirmedIntent());
    expect(transaction.state).toBe("PAYMENT_PENDING");

    // The intent's TTL is 900s (harness default); step past it.
    harness.clock.advance(900_000 + 1);

    const swept = await harness.engine.sweepExpired();
    expect(swept).toHaveLength(1);
    const failed = swept[0];
    expect(failed?.state).toBe("FAILED");
    expect(failed?.failure?.code).toBe("PAYMENT_EXPIRED");

    const intent = await harness.intents.getById(transaction.paymentIntentId);
    expect(intent.status).toBe("FAILED");
    expect(await harness.engine.sweepExpired()).toHaveLength(0);
  });

  test("leaves a payment alone before its deadline", async () => {
    const harness = createHarness({ autoConfirmAssetReceipt: false });
    await harness.engine.start(await harness.confirmedIntent());

    harness.clock.advance(60_000);

    expect(await harness.engine.sweepExpired()).toHaveLength(0);
  });

  test("does not fail a payment whose asset is already in flight", async () => {
    const harness = createHarness({ behaviour: "pending" });
    const settling = await harness.engine.start(await harness.confirmedIntent());
    expect(settling.state).toBe("SETTLING");

    harness.clock.advance(900_000 + 1);

    expect(await harness.engine.sweepExpired()).toHaveLength(0);
    const reloaded = await harness.engine.getById(settling.id);
    expect(reloaded.state).toBe("SETTLING");
  });
});
