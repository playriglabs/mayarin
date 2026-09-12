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
    // The mark, not a text eyebrow, and with an alt for a client that blocks
    // images.
    expect(calls[0]?.payload.html).toContain('alt="Mayarin"');
    expect(calls[0]?.payload.html).not.toContain("Mayarin invoice</p>");
    // The card, the totals panel and the button, each with its own radius.
    expect(calls[0]?.payload.html).toContain("border-radius:16px");
    expect(calls[0]?.payload.html).toContain("border-radius:12px");
    expect(calls[0]?.payload.html).toContain("border-radius:8px");
    // Named on every element, not only on `body`: Gmail does not inherit it.
    expect(calls[0]?.payload.html?.match(/font-family:Geist,/g)?.length).toBeGreaterThanOrEqual(5);
    // The URL is masked in the HTML and spelled out in the text part, which has
    // nowhere to hide a link.
    expect(calls[0]?.payload.html).toContain(">Pay with this link</a>");
    expect(calls[0]?.payload.text).toContain("https://pay.example.com/invoices/inv_1/view");
  });
});
