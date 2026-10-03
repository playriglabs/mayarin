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
      merchantLogoUrl: undefined,
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
    // The logo rides inside the message: remote images are blocked on first open.
    expect(calls[0]?.payload.html).toContain('src="cid:mayarin-logo"');
    // The logo and the footer icons, each referenced by its `cid:`.
    expect(calls[0]?.payload.attachments).toEqual([
      expect.objectContaining({ contentId: "mayarin-logo", contentType: "image/png" }),
      expect.objectContaining({ contentId: "mayarin-x", contentType: "image/png" }),
      expect.objectContaining({ contentId: "mayarin-linkedin", contentType: "image/png" }),
      expect.objectContaining({ contentId: "mayarin-email", contentType: "image/png" }),
    ]);
    // The footer: where to find Mayarin, on every email.
    expect(calls[0]?.payload.html).toContain('src="cid:mayarin-x"');
    expect(calls[0]?.payload.html).toContain("https://x.com/mayarin_xyz");
    expect(calls[0]?.payload.html).toContain("mailto:hello@mayarin.xyz");
    expect(calls[0]?.payload.text).toContain("hello@mayarin.xyz");
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

  test("an uploaded merchant logo replaces Mayarin's", async () => {
    const calls: CreateEmailOptions[] = [];
    const sender = new ResendInvoiceEmailSender({
      apiKey: "re_test",
      from: "Mayarin <onboarding@resend.dev>",
      resend: {
        emails: {
          send: async (payload) => {
            calls.push(payload);
            return { data: { id: "eml_resend_2" }, error: null, headers: null };
          },
        },
      },
    });

    await sender.sendInvoice({
      invoiceId: "inv_2",
      deliveryId: "00000000-0000-4000-8000-000000000002",
      invoiceNumber: "INV/2026/0002",
      merchantName: "Toko Kopi",
      merchantLogoUrl: "https://pub-test.r2.dev/merchant-logos/mrc_1/01J.png",
      buyerName: "Client",
      buyerEmail: "owner@example.com",
      total: "Rp 1,00",
      outstanding: "Rp 1,00",
      dueAt: null,
      url: "https://pay.example.com/invoices/inv_2/view",
    });

    // Same `cid:`, different image behind it — and named for the merchant.
    expect(calls[0]?.html).toContain('src="cid:mayarin-logo"');
    expect(calls[0]?.html).toContain('alt="Toko Kopi"');
    expect(calls[0]?.attachments?.[0]).toEqual(
      expect.objectContaining({
        path: "https://pub-test.r2.dev/merchant-logos/mrc_1/01J.png",
        contentId: "mayarin-logo",
        contentType: "image/png",
      }),
    );
    // Mayarin's footer icons still ride along.
    expect(calls[0]?.attachments).toHaveLength(4);
  });
});
