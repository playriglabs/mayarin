import { describe, expect, test } from "bun:test";
import { createApiHarness, qrisPayload } from "./harness.ts";

async function createdPayment() {
  const harness = createApiHarness();
  const created = await harness.request("POST", "/v1/payment-intents", {
    body: { qr: qrisPayload() },
  });
  const id: string = created.body.paymentIntent.id;
  return { harness, id };
}

describe("GET /payments/:id/{invoice,receipt}.pdf (#293)", () => {
  test("serves the invoice of a payment that has not been paid yet", async () => {
    const { harness, id } = await createdPayment();

    const response = await harness.app.request(`/v1/payments/${id}/invoice.pdf`, {
      headers: { "x-payer-token": harness.payerToken(id) },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toStartWith(
      'attachment; filename="invoice-',
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });

  test("refuses the receipt until the payment has completed", async () => {
    const { harness, id } = await createdPayment();

    const { status, body } = await harness.request("GET", `/v1/payments/${id}/receipt.pdf`);

    expect(status).toBe(409);
    expect(body.error.code).toBe("CONFLICT");
  });

  test("serves the receipt once the payment has completed", async () => {
    const { harness, id } = await createdPayment();
    await harness.request("POST", `/v1/payment-intents/${id}/confirm`);

    const response = await harness.app.request(`/v1/payments/${id}/receipt.pdf`, {
      headers: { "x-payer-token": harness.payerToken(id) },
    });

    expect(response.status).toBe(200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    if (process.env.DOCUMENTS_SAMPLE_DIR !== undefined) {
      await Bun.write(`${process.env.DOCUMENTS_SAMPLE_DIR}/receipt.pdf`, bytes);
    }
  });

  test("answers 404 for an unknown payment", async () => {
    const harness = createApiHarness();
    const { status } = await harness.request("GET", "/v1/payments/pi_missing/invoice.pdf");
    expect(status).toBe(404);
  });
});
