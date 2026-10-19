import { describe, expect, test } from "bun:test";
import { createApiHarness, TEST_MERCHANT_ID } from "./harness.ts";

const NOW = new Date("2026-01-01T00:00:00.000Z");

const input = (merchantId: string, paymentIntentId: string) => ({
  paymentIntentId,
  merchantId,
  chain: "base-sepolia",
  factory: "0x0000000000000000000000000000000000000f01",
  payer: "0x000000000000000000000000000000000000cafe",
  payee: "0x000000000000000000000000000000000000beef",
  arbiter: "0x00000000000000000000000000000000000000a1",
  releaseAfter: NOW,
  resolveBy: new Date(NOW.getTime() + 7 * 86_400_000),
});

async function setup() {
  const harness = createApiHarness();
  const mine = (await harness.escrowDisputes.open(input(TEST_MERCHANT_ID, "pi_1"), NOW)).dispute;
  const second = (await harness.escrowDisputes.open(input(TEST_MERCHANT_ID, "pi_2"), NOW)).dispute;
  const theirs = (await harness.escrowDisputes.open(input("mrc_other", "pi_3"), NOW)).dispute;
  await harness.escrowDisputes.addMessage(mine.id, "payer", "I never received it", NOW);
  await harness.escrowDisputes.close("pi_2", "refunded", NOW);
  return { harness, mine, second, theirs };
}

describe("merchant disputes API (#313)", () => {
  test("lists the merchant's own disputes with the number still open, and filters by status", async () => {
    const { harness, mine, second } = await setup();

    const all = await harness.request("GET", "/v1/disputes");
    expect(all.status).toBe(200);
    expect(all.body.disputes.map((d: { id: string }) => d.id).sort()).toEqual(
      [mine.id, second.id].sort(),
    );
    expect(all.body.open).toBe(1);
    expect(all.body.disputes[0]).toHaveProperty("reference");

    const open = await harness.request("GET", "/v1/disputes?status=open");
    expect(open.body.disputes.map((d: { id: string }) => d.id)).toEqual([mine.id]);
    expect(open.body.open).toBe(1);

    const refunded = await harness.request("GET", "/v1/disputes?status=refunded");
    expect(refunded.body.disputes).toHaveLength(1);
    expect(refunded.body.disputes[0].decidedAt).not.toBeNull();
  });

  test("never lists another merchant's dispute", async () => {
    const { harness, theirs } = await setup();
    const list = await harness.request("GET", "/v1/disputes");
    expect(list.body.disputes.map((d: { id: string }) => d.id)).not.toContain(theirs.id);
  });

  test("a dispute comes with its thread, oldest first", async () => {
    const { harness, mine } = await setup();
    const { status, body } = await harness.request("GET", `/v1/disputes/${mine.id}`);

    expect(status).toBe(200);
    expect(body.dispute).toMatchObject({
      id: mine.id,
      paymentIntentId: "pi_1",
      status: "open",
      chain: "base-sepolia",
      messages: [{ author: "payer", body: "I never received it" }],
    });
  });

  test("another merchant's dispute, and one that does not exist, are the same 404", async () => {
    const { harness, theirs } = await setup();
    const foreign = await harness.request("GET", `/v1/disputes/${theirs.id}`);
    const missing = await harness.request("GET", "/v1/disputes/dsp_nope");
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.body.error.code).toBe(missing.body.error.code);
  });

  test("the merchant answers: the message is saved, trimmed, and announced", async () => {
    const { harness, mine } = await setup();
    const posted = await harness.request("POST", `/v1/disputes/${mine.id}/messages`, {
      body: { body: "  Tracking JNE 123, delivered 2 Oct  " },
    });

    expect(posted.status).toBe(201);
    expect(posted.body.message).toMatchObject({
      author: "merchant",
      body: "Tracking JNE 123, delivered 2 Oct",
    });
    expect(harness.disputeNotices.messages).toEqual([
      { disputeId: mine.id, messageId: posted.body.message.id },
    ]);

    const thread = await harness.request("GET", `/v1/disputes/${mine.id}`);
    expect(thread.body.dispute.messages.map((m: { author: string }) => m.author)).toEqual([
      "payer",
      "merchant",
    ]);
  });

  test("an empty or oversized message, and one on a decided dispute, are refused", async () => {
    const { harness, mine, second } = await setup();
    const empty = await harness.request("POST", `/v1/disputes/${mine.id}/messages`, {
      body: { body: "   " },
    });
    expect(empty.status).toBe(400);
    const long = await harness.request("POST", `/v1/disputes/${mine.id}/messages`, {
      body: { body: "x".repeat(2_001) },
    });
    expect(long.status).toBe(400);
    const decided = await harness.request("POST", `/v1/disputes/${second.id}/messages`, {
      body: { body: "too late" },
    });
    expect(decided.status).toBe(409);
  });

  test("cannot answer another merchant's dispute", async () => {
    const { harness, theirs } = await setup();
    const response = await harness.request("POST", `/v1/disputes/${theirs.id}/messages`, {
      body: { body: "hello" },
    });
    expect(response.status).toBe(404);
  });

  test("reading needs payments:read, answering needs disputes:manage, and neither takes a publishable key", async () => {
    const { harness, mine } = await setup();
    const reader = harness.mintApiKey(TEST_MERCHANT_ID, "mak_test_reader", ["payments:read"]);
    const refunder = harness.mintApiKey(TEST_MERCHANT_ID, "mak_test_refunder", ["refunds:manage"]);
    const publishable = harness.mintApiKey(TEST_MERCHANT_ID, "mak_test_pub", [], "publishable");
    const as = (key: string) => ({ auth: key });

    expect((await harness.request("GET", "/v1/disputes", as(reader))).status).toBe(200);
    expect(
      (
        await harness.request("POST", `/v1/disputes/${mine.id}/messages`, {
          ...as(reader),
          body: { body: "hi" },
        })
      ).status,
    ).toBe(403);

    // A key that may refund may not speak for the merchant before an arbiter.
    expect(
      (
        await harness.request("POST", `/v1/disputes/${mine.id}/messages`, {
          ...as(refunder),
          body: { body: "hi" },
        })
      ).status,
    ).toBe(403);
    expect((await harness.request("GET", "/v1/disputes", as(refunder))).status).toBe(403);

    expect((await harness.request("GET", "/v1/disputes", as(publishable))).status).toBe(403);
    expect((await harness.request("GET", "/v1/disputes", { auth: false })).status).toBe(401);
  });
});
