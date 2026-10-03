import { describe, expect, test } from "bun:test";
import { money } from "@mayarin/shared";
import { renderDocumentPdf } from "../src/services/document-pdf.ts";

/** A 1×1 PNG: enough for pdf-lib to embed. */
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  ),
  (char) => char.charCodeAt(0),
);

const doc = {
  kind: "invoice",
  paymentId: "pi_1",
  invoiceNumber: "INV-1",
  issuedAt: new Date("2026-10-01T00:00:00Z"),
  seller: { name: "Toko Kopi", lines: ["Jakarta", "ID"], logoUrl: "https://logos.test/1.png" },
  lines: [
    {
      description: "Kopi",
      quantity: 1,
      unitPrice: money(5_000_000n, "IDR"),
      amount: money(5_000_000n, "IDR"),
    },
  ],
  total: money(5_000_000n, "IDR"),
} as const;

describe("renderDocumentPdf", () => {
  test("embeds the merchant logo", async () => {
    const without = await renderDocumentPdf(doc);
    const withLogo = await renderDocumentPdf(doc, PNG);

    expect(new TextDecoder().decode(withLogo.slice(0, 5))).toBe("%PDF-");
    // An image XObject only exists when the logo was drawn.
    expect(new TextDecoder().decode(withLogo)).toContain("/Subtype /Image");
    expect(new TextDecoder().decode(without)).not.toContain("/Subtype /Image");
  });

  test("ignores bytes that are neither PNG nor JPEG rather than failing the PDF", async () => {
    const bytes = await renderDocumentPdf(doc, new TextEncoder().encode("not an image"));

    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });
});
