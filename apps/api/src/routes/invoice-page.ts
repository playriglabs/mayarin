/**
 * Hosted invoice page (#112).
 *
 * One page that serves two readers. On screen a buyer sees what is owed and a
 * button that mints a Payment Intent for it. On paper — the same URL, printed —
 * a finance team sees a document they can file: number, dates, both parties,
 * line items, and what has been paid.
 *
 * The printable view is `@media print` rather than a second route, so the
 * printed page can never drift from the one the buyer looked at. A separate
 * `/print` endpoint is two renderers and one of them goes stale.
 *
 * Server-rendered HTML with no client framework, matching the hosted checkout
 * page: a buyer opening an invoice on a bad connection in a warehouse should
 * not wait on a bundle.
 */

import type { InvoiceView } from "@mayarin/invoicing";
import { formatMoneyLocale, type Money } from "@mayarin/shared";
import { Hono } from "hono";
import type { Container } from "../container.ts";

export function invoicePageRoutes(container: Container): Hono {
  const app = new Hono();
  const baseUrl = container.config.publicBaseUrl;

  app.get("/:id/view", async (c) => {
    const view = await container.invoices.viewInvoice(c.req.param("id"));
    return c.html(invoicePage(view, `${baseUrl}/v1/invoices/${view.invoice.id}/checkout`));
  });

  return app;
}

/**
 * HTML-escapes a value.
 *
 * Buyer names, notes and line descriptions are attacker-controlled as far as
 * this page is concerned — a merchant account is created by whoever signs up,
 * and the buyer details are whatever that merchant typed.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const DATE = new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeZone: "Asia/Jakarta" });

function formatDate(value: Date | undefined): string {
  return value === undefined ? "—" : DATE.format(value);
}

function amount(value: Money): string {
  return escapeHtml(formatMoneyLocale(value));
}

const STATUS_LABEL: Readonly<Record<InvoiceView["status"], string>> = {
  draft: "Draf",
  issued: "Belum dibayar",
  partially_paid: "Dibayar sebagian",
  paid: "Lunas",
  overdue: "Jatuh tempo",
  void: "Dibatalkan",
};

/** Only these two carry a warning colour. The rest are ordinary states. */
const STATUS_TONE: Readonly<Record<InvoiceView["status"], string>> = {
  draft: "muted",
  issued: "muted",
  partially_paid: "warn",
  paid: "ok",
  overdue: "warn",
  void: "muted",
};

function invoicePage(view: InvoiceView, checkoutUrl: string): string {
  const { invoice, status, paid, outstanding } = view;
  const payable = status !== "void" && status !== "draft" && outstanding.amount > 0n;

  const lines = invoice.lines
    .map(
      (line) => `<tr>
        <td>${escapeHtml(line.name)}</td>
        <td class="num">${line.quantity}</td>
        <td class="num">${amount(line.unitPrice)}</td>
        <td class="num">${amount({ amount: line.unitPrice.amount * BigInt(line.quantity), asset: line.unitPrice.asset })}</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Faktur ${escapeHtml(invoice.number ?? invoice.id)}</title>
<style>
  :root { color-scheme: light dark; --bg:#fff; --fg:#101014; --muted:#5b5b66; --line:#e3e3e8; --ok:#1f6f54; --warn:#8a6100; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0d0d10; --fg:#f2f2f5; --muted:#9a9aa6; --line:#26262d; --ok:#31b285; --warn:#d9a514; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg);
         font:15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
         display:flex; justify-content:center; padding:24px; }
  main { width:100%; max-width:44rem; }
  header { display:flex; justify-content:space-between; gap:16px; flex-wrap:wrap;
           border-bottom:1px solid var(--line); padding-bottom:16px; }
  h1 { font-size:1.4rem; margin:0 0 2px; letter-spacing:-0.01em; }
  .muted { color:var(--muted); font-size:0.85rem; }
  .ok { color:var(--ok); } .warn { color:var(--warn); }
  .badge { font-size:0.8rem; font-weight:600; }
  .parties { display:flex; gap:32px; flex-wrap:wrap; margin:20px 0; }
  .party { min-width:12rem; }
  .party dt { font-size:0.75rem; text-transform:uppercase; letter-spacing:0.06em; color:var(--muted); margin-bottom:4px; }
  .party dd { margin:0; }
  table { width:100%; border-collapse:collapse; margin-top:8px; }
  th, td { text-align:left; padding:8px 0; border-bottom:1px solid var(--line); }
  th { font-size:0.75rem; text-transform:uppercase; letter-spacing:0.06em; color:var(--muted); font-weight:600; }
  .num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
  tfoot td { border-bottom:none; padding-top:10px; }
  tfoot .total { font-weight:650; font-size:1.05rem; }
  .notes { margin-top:20px; white-space:pre-wrap; }
  .pay { display:block; width:100%; margin-top:24px; padding:14px; border:0; border-radius:10px;
         background:var(--fg); color:var(--bg); font:inherit; font-weight:600; cursor:pointer; }
  .pay:disabled { opacity:.5; cursor:default; }
  /* Print is the document, so the interactive parts and the page chrome go. */
  @media print {
    :root { --bg:#fff; --fg:#000; --muted:#444; --line:#bbb; }
    body { padding:0; display:block; }
    main { max-width:none; }
    .pay, .screen-only { display:none !important; }
    a[href]:after { content:""; }
  }
</style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>Faktur ${escapeHtml(invoice.number ?? "(draf)")}</h1>
      <p class="muted">Diterbitkan ${formatDate(invoice.issuedAt)} · Jatuh tempo ${formatDate(invoice.dueAt)}</p>
    </div>
    <div>
      <p class="badge ${STATUS_TONE[status]}">${STATUS_LABEL[status]}</p>
    </div>
  </header>

  <div class="parties">
    <dl class="party">
      <dt>Dari</dt>
      <dd>${escapeHtml(invoice.merchant.name)}</dd>
      <dd class="muted">${escapeHtml(invoice.merchant.city)}</dd>
    </dl>
    <dl class="party">
      <dt>Untuk</dt>
      <dd>${escapeHtml(invoice.buyer.name)}</dd>
      ${invoice.buyer.address === undefined ? "" : `<dd class="muted">${escapeHtml(invoice.buyer.address)}</dd>`}
      ${invoice.buyer.taxId === undefined ? "" : `<dd class="muted">NPWP ${escapeHtml(invoice.buyer.taxId)}</dd>`}
      ${invoice.buyer.email === undefined ? "" : `<dd class="muted">${escapeHtml(invoice.buyer.email)}</dd>`}
    </dl>
  </div>

  <table>
    <thead>
      <tr><th>Keterangan</th><th class="num">Jumlah</th><th class="num">Harga</th><th class="num">Total</th></tr>
    </thead>
    <tbody>${lines}</tbody>
    <tfoot>
      <tr><td colspan="3">Total</td><td class="num total">${amount(invoice.total)}</td></tr>
      <tr><td colspan="3" class="muted">Sudah dibayar</td><td class="num muted">${amount(paid)}</td></tr>
      <tr><td colspan="3">Sisa tagihan</td><td class="num total">${amount(outstanding)}</td></tr>
    </tfoot>
  </table>

  ${invoice.notes === undefined ? "" : `<p class="notes muted">${escapeHtml(invoice.notes)}</p>`}

  <button class="pay" type="button" ${payable ? "" : "disabled"} onclick="pay()">
    ${payable ? `Bayar ${amount(outstanding)}` : STATUS_LABEL[status]}
  </button>
</main>
<script>
  async function pay() {
    const button = document.querySelector(".pay");
    button.disabled = true;
    const response = await fetch(${JSON.stringify(checkoutUrl)}, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    if (!response.ok) { button.disabled = false; return; }
    const { paymentIntent } = await response.json();
    window.location.href = "/checkout/pay/" + paymentIntent.id;
  }
</script>
</body>
</html>`;
}
