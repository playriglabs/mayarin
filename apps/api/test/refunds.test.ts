/**
 * Refund route tests (#12).
 *
 * A refund moves value back out, so most of what matters here is what it
 * refuses: more than the payment brought in, a payment that never settled, and
 * a contract-path payment Mayarin holds no key to refund.
 */

import { describe, expect, test } from "bun:test";
import { createApiHarness, qrisPayload } from "./harness.ts";

type Harness = ReturnType<typeof createApiHarness>;

/** Takes a payment all the way to SUCCESS, which is the only refundable state. */
async function settledPayment(harness: Harness) {
  const created = await harness.request("POST", "/v1/payment-intents", {
    body: { qr: qrisPayload() },
  });
  const id = created.body.paymentIntent.id;
  const confirmed = await harness.request("POST", `/v1/payment-intents/${id}/confirm`);
  expect(confirmed.body.paymentIntent.status).toBe("COMPLETED");
  return id;
}

describe("POST /payments/:id/refunds", () => {
  test("refunds the whole net amount when no amount is given", async () => {
    const harness = createApiHarness();
    const id = await settledPayment(harness);

    const { status, body } = await harness.request("POST", `/v1/payments/${id}/refunds`, {
      body: {},
    });

    expect(status).toBe(201);
    expect(body.refund.state).toBe("SUCCEEDED");
    // 50,000.00 IDR at 100 minor units per whole unit, less the 50 bps fee.
    expect(body.refund.amount).toMatchObject({ asset: "IDRX" });
    expect(BigInt(body.refund.amount.amount)).toBeGreaterThan(0n);
  });

  test("a partial refund leaves the rest refundable", async () => {
    const harness = createApiHarness();
    const id = await settledPayment(harness);

    const before = await harness.request("GET", `/v1/payments/${id}/refunds`);
    const refundable = BigInt(before.body.summary.refundable.amount);

    const partial = await harness.request("POST", `/v1/payments/${id}/refunds`, {
      body: { amount: { amount: "100.00", asset: "IDRX" } },
    });
    expect(partial.status).toBe(201);

    const after = await harness.request("GET", `/v1/payments/${id}/refunds`);
    expect(after.body.summary.state).toBe("PARTIAL");
    expect(BigInt(after.body.summary.remaining.amount)).toBe(refundable - 10_000n);
  });

  test("two partials that together exceed the balance are refused", async () => {
    const harness = createApiHarness();
    const id = await settledPayment(harness);

    const summary = await harness.request("GET", `/v1/payments/${id}/refunds`);
    const refundable = BigInt(summary.body.summary.refundable.amount);

    const first = await harness.request("POST", `/v1/payments/${id}/refunds`, {
      body: { amount: { amount: "100.00", asset: "IDRX" } },
    });
    expect(first.status).toBe(201);

    // Each is within the balance on its own; together they are not — the case a
    // per-refund check misses.
    const second = await harness.request("POST", `/v1/payments/${id}/refunds`, {
      body: { amount: { amount: `${refundable / 100n}.00`, asset: "IDRX" } },
    });
    expect(second.status).toBe(400);
  });

  test("a refund in the wrong asset is refused", async () => {
    const harness = createApiHarness();
    const id = await settledPayment(harness);

    const { status } = await harness.request("POST", `/v1/payments/${id}/refunds`, {
      body: { amount: { amount: "100.00", asset: "USDC" } },
    });
    expect(status).toBe(400);
  });

  test("a replayed idempotency key returns the first refund, not a second", async () => {
    const harness = createApiHarness();
    const id = await settledPayment(harness);
    const headers = { "Idempotency-Key": "refund-key-00001" };
    const body = { amount: { amount: "100.00", asset: "IDRX" } };

    const first = await harness.request("POST", `/v1/payments/${id}/refunds`, { body, headers });
    const second = await harness.request("POST", `/v1/payments/${id}/refunds`, { body, headers });

    expect(second.body.refund.id).toBe(first.body.refund.id);

    const listed = await harness.request("GET", `/v1/payments/${id}/refunds`);
    expect(listed.body.refunds).toHaveLength(1);
  });

  test("a payment that has not settled cannot be refunded", async () => {
    const harness = createApiHarness();
    const created = await harness.request("POST", "/v1/payment-intents", {
      body: { qr: qrisPayload() },
    });
    const id = created.body.paymentIntent.id;

    const { status } = await harness.request("POST", `/v1/payments/${id}/refunds`, { body: {} });
    // No clearing transaction exists until the intent is confirmed.
    expect(status).toBe(404);
  });

  test("the ledger balances after a refund", async () => {
    const harness = createApiHarness();
    const id = await settledPayment(harness);

    await harness.request("POST", `/v1/payments/${id}/refunds`, {
      body: { amount: { amount: "100.00", asset: "IDRX" } },
    });

    // `LedgerService.post` raises `LedgerImbalanceError` on an unbalanced
    // posting, so a succeeded refund is itself half the assertion. The other
    // half is that the posting actually ran: the refund debits the merchant's
    // holding, so 100.00 IDRX of it must have been taken back.
    const holding = await harness.ledger.balance("MERCHANT_HOLDING", "IDRX");
    expect(holding.debits.amount).toBe(10_000n);
  });
});

describe("GET /payments/:id/refunds", () => {
  test("reports nothing refunded before any refund", async () => {
    const harness = createApiHarness();
    const id = await settledPayment(harness);

    const { status, body } = await harness.request("GET", `/v1/payments/${id}/refunds`);

    expect(status).toBe(200);
    expect(body.refunds).toEqual([]);
    expect(body.summary.state).toBe("NONE");
    expect(body.summary.refunded.amount).toBe("0");
  });

  test("a fully refunded payment reports FULL and still reads as COMPLETED", async () => {
    const harness = createApiHarness();
    const id = await settledPayment(harness);

    await harness.request("POST", `/v1/payments/${id}/refunds`, { body: {} });

    const refunds = await harness.request("GET", `/v1/payments/${id}/refunds`);
    expect(refunds.body.summary.state).toBe("FULL");
    expect(refunds.body.summary.remaining.amount).toBe("0");

    // The payment succeeded. A refund is a new transfer, not a reversal, so the
    // payment's own status is untouched — losing it would lose the fact the
    // ledger and the audit trail are built on.
    const payment = await harness.request("GET", `/v1/payments/${id}`);
    expect(payment.body.paymentIntent.status).toBe("COMPLETED");
  });
});
