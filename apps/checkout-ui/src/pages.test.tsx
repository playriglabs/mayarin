/**
 * Rendering tests, without a browser.
 *
 * `renderToStaticMarkup` runs the components' render pass (not their effects),
 * which is exactly the surface these tests pin: what a buyer is shown for a
 * given bootstrap. The live behaviour — streams, polls, fetches — stays thin
 * inside the components and its decisions live in `logic.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { InvoicePage } from "./InvoicePage.tsx";
import { LinkPage } from "./LinkPage.tsx";
import { PayPage } from "./PayPage.tsx";
import type { InvoiceBootstrap, LinkBootstrap, MoneyDto, PayBootstrap } from "./types.ts";

function idr(display: string): MoneyDto {
  return { amount: "0", asset: "IDR", formatted: "0.00", display };
}

const linkBootstrap: LinkBootstrap = {
  page: "link",
  linkId: "plk_1",
  kind: "fixed",
  title: "Paket",
  merchant: { name: "Warung Kopi", city: "Jakarta" },
  payable: true,
  currency: "IDR",
  total: idr("Rp 50.000,00"),
  lines: null,
  accepted: ["USDC", "ETH"],
  chain: "base-sepolia",
  lockMinutes: 15,
};

const payBootstrap: PayBootstrap = {
  page: "pay",
  intentId: "pi_1",
  amount: idr("Rp 50.000,00"),
  merchant: { name: "Warung Kopi", city: "Jakarta" },
  title: "Paket",
  lines: null,
  expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  statusUrl: "http://localhost:3000/v1/payments/pi_1",
  streaming: true,
  successUrl: null,
  pollMs: 8000,
};

const invoiceBootstrap: InvoiceBootstrap = {
  page: "invoice",
  invoiceId: "inv_1",
  number: "INV-0001",
  status: "issued",
  merchant: { name: "Warung Kopi", city: "Jakarta" },
  buyer: { name: "Budi", email: null, taxId: "12.345", address: null },
  lines: [
    {
      name: "Kopi arabika 1kg",
      quantity: 2,
      unitPrice: idr("Rp 25.000,00"),
      lineTotal: idr("Rp 50.000,00"),
    },
  ],
  total: idr("Rp 125.000,00"),
  paid: idr("Rp 0,00"),
  outstanding: idr("Rp 125.000,00"),
  notes: null,
  issuedAt: "2026-01-01T00:00:00.000Z",
  dueAt: "2026-02-01T00:00:00.000Z",
  payable: true,
  checkoutUrl: "http://localhost:3000/v1/invoices/inv_1/checkout",
};

describe("link page", () => {
  test("shows the priced total, the assets, and the lock note — and no QR", () => {
    const html = renderToStaticMarkup(<LinkPage bootstrap={linkBootstrap} />);
    expect(html).toContain("Rp 50.000,00");
    expect(html).toContain("Paket");
    expect(html).toContain("Warung Kopi — Jakarta");
    expect(html).toContain('alt="Mayarin"');
    expect(html).toContain("Pay with");
    expect(html).toContain("USDC");
    expect(html).toContain("Prices are locked for 15 minutes");
    // The QR that used to sit here encoded the page's own URL. It belongs to
    // the counter — the dashboard's "Take payment" — not to the buyer.
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("/checkout/qr");
  });

  test("an open link asks for an amount instead of showing a total", () => {
    const html = renderToStaticMarkup(
      <LinkPage bootstrap={{ ...linkBootstrap, kind: "open", total: null }} />,
    );
    expect(html).toContain("Amount");
    expect(html).toContain('inputMode="decimal"');
  });

  test("a dead link says so and offers no button", () => {
    const html = renderToStaticMarkup(
      <LinkPage bootstrap={{ ...linkBootstrap, payable: false }} />,
    );
    expect(html).toContain("This payment link is no longer available");
    expect(html).not.toContain("Lanjut bayar");
  });
});

describe("pay page", () => {
  test("first paint carries the amount, the countdown, and the lock-in-progress card", () => {
    const html = renderToStaticMarkup(<PayPage bootstrap={payBootstrap} />);
    expect(html).toContain("Rp 50.000,00");
    expect(html).toContain("Time left");
    expect(html).toContain("Preparing your payment address");
    expect(html).toContain("pi_1");
  });

  test("shows product context and Mayarin attribution in the summary rail", () => {
    const line = {
      name: "Kopi Susu",
      description: "Kopi susu gula aren",
      imageUrl: "https://cdn.example.com/kopi.webp",
      quantity: 2,
      unitPrice: idr("Rp 25.000,00"),
      lineTotal: idr("Rp 50.000,00"),
    };
    const html = renderToStaticMarkup(
      <LinkPage bootstrap={{ ...linkBootstrap, kind: "catalog", lines: [line] }} />,
    );
    expect(html).toContain("Kopi susu gula aren");
    expect(html).toContain("https://cdn.example.com/kopi.webp");
    expect(html).toContain("Powered by");
    expect(html).toContain("mayarin.xyz");
  });

  test("the countdown is already ticking at first paint, not waiting on a fetch", () => {
    const html = renderToStaticMarkup(<PayPage bootstrap={payBootstrap} />);
    // 10 minutes out: a concrete mm:ss figure, not a placeholder.
    expect(html).toMatch(/0(9|10):\d\d/);
  });
});

describe("invoice page", () => {
  test("renders the document: parties, lines, and the derived figures", () => {
    const html = renderToStaticMarkup(<InvoicePage bootstrap={invoiceBootstrap} />);
    expect(html).toContain("Invoice INV-0001");
    expect(html).toContain("Budi");
    expect(html).toContain("Tax ID 12.345");
    expect(html).toContain("Kopi arabika 1kg");
    expect(html).toContain("Amount due");
    expect(html).toContain("Rp 125.000,00");
    expect(html).toContain("Pay Rp 125.000,00");
  });

  test("a settled invoice offers no payment button", () => {
    const html = renderToStaticMarkup(
      <InvoicePage
        bootstrap={{
          ...invoiceBootstrap,
          status: "paid",
          payable: false,
          outstanding: idr("Rp 0,00"),
        }}
      />,
    );
    expect(html).toContain("disabled");
    expect(html).toContain("Paid");
  });
});

describe("print view", () => {
  test("is the same page, not a second renderer", async () => {
    // The printable invoice is `@media print` in the shared stylesheet: a
    // separate `/print` endpoint would be two renderers, one going stale.
    const css = await Bun.file(new URL("./styles.css", import.meta.url)).text();
    expect(css).toContain("@media print");
  });
});

describe("the shell", () => {
  test("keeps the placeholder the API injects the bootstrap into", async () => {
    // The API replaces this exact comment per request
    // (apps/api/src/services/checkout-shell.ts). Removing it from index.html
    // would 500 every buyer page while every other test stayed green.
    const html = await Bun.file(new URL("../index.html", import.meta.url)).text();
    expect(html).toContain("<!--__BOOTSTRAP__-->");
  });
});
