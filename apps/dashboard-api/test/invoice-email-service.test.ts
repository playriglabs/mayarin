import { describe, expect, test } from "bun:test";
import type { CreateEmailOptions, CreateEmailRequestOptions } from "resend";
import { ResendInvoiceEmailSender } from "../src/services/invoice-email-service.ts";

describe("ResendInvoiceEmailSender", () => {
  test("sends an escaped invoice email with a stable idempotency key", async () => {
    const calls: Array<{
      readonly payload: CreateEmailOptions;
      readonly options: CreateEmailRequestOptions | undefined;
    }> = [];
    const sender = new ResendInvoiceEmailSender({
      apiKey: "re_test",
      from: "Mayarin <onboarding@resend.dev>",
      resend: {
        emails: {
          send: async (payload, options) => {
            calls.push({ payload, options });
            return { data: { id: "eml_resend_1" }, error: null, headers: null };
          },
        },
      },
    });

    const delivery = await sender.sendInvoice({
      invoiceId: "inv_1",
      deliveryId: "00000000-0000-4000-8000-000000000001",
      invoiceNumber: "INV/2026/0001",
      merchantName: "Mayarin & Co",
      buyerName: "Client <Finance>",
      buyerEmail: "owner@example.com",
      total: "Rp 250.000,00",
      outstanding: "Rp 250.000,00",
      dueAt: "2026-01-31T23:59:59.999Z",
      url: "https://pay.example.com/invoices/inv_1/view?from=email&safe=true",
    });

    expect(delivery).toEqual({ id: "eml_resend_1", recipient: "owner@example.com" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.options?.idempotencyKey).toBe(
      "invoice-inv_1-00000000-0000-4000-8000-000000000001",
    );
    expect(calls[0]?.payload.to).toBe("owner@example.com");
    expect(calls[0]?.payload.html).toContain("Mayarin &amp; Co");
    expect(calls[0]?.payload.html).toContain("Client &lt;Finance&gt;");
    expect(calls[0]?.payload.html?.match(/border-radius:2px/g)).toHaveLength(3);
    expect(calls[0]?.payload.text).toContain("https://pay.example.com/invoices/inv_1/view");
  });
});
