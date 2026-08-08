/**
 * Hosted checkout (#10).
 *
 * Two pages a buyer sees and a merchant ships nothing to get: the link page,
 * which mints an intent, and the payment page, which shows what to pay and
 * where. Server-rendered, self-contained, no build step and no external assets
 * — a checkout that cannot render because a CDN is unreachable is a checkout
 * that loses the sale.
 *
 * Status is polled. Real-time status arrives with #13; until then the page says
 * how it knows what it knows rather than pretending to be live.
 */

import { isLinkPayable, type PaymentLink } from "@mayarin/catalog";
import { formatMoneyLocale, type Money, ValidationError } from "@mayarin/shared";
import { Hono } from "hono";
import { toString as qrToString } from "qrcode";
import type { Container } from "../container.ts";

/** How often the payment page asks the API what happened. */
const POLL_MS = 4_000;

export function checkoutPageRoutes(container: Container): Hono {
  const app = new Hono();
  const baseUrl = container.config.publicBaseUrl;

  /**
   * Renders any string as a QR.
   *
   * Its own endpoint because the deposit URI only exists after the payment has
   * locked a price, so it arrives with a poll rather than with the page. Encodes
   * the string it is given and fetches nothing, so the only thing a caller can
   * do with it is render their own text.
   */
  app.get("/qr", async (c) => {
    const value = c.req.query("value") ?? "";
    if (value.length === 0 || value.length > 512) {
      throw new ValidationError("A QR value must be between 1 and 512 characters", {
        length: value.length,
      });
    }
    return c.body(await qrSvg(value), 200, { "Content-Type": "image/svg+xml" });
  });

  /** The payment page: amount, deposit address, QR, and polled status. */
  app.get("/pay/:intentId", async (c) => {
    const intentId = c.req.param("intentId");
    const { intent } = await container.paymentApp.getPayment(intentId);
    return c.html(payPage(intent.id, intent.amount, `${baseUrl}/payments/${intent.id}`));
  });

  /**
   * The link page: what is being sold, and a button that mints an intent.
   *
   * Registered last because it is the catch-all: Hono matches in registration
   * order, so `/qr` and `/pay/:intentId` would otherwise be read as link ids.
   */
  app.get("/:linkId", async (c) => {
    const link = await container.catalog.getLink(c.req.param("linkId"));
    const payable = isLinkPayable(link, new Date());
    return c.html(await linkPage(link, payable, `${baseUrl}/checkout/${link.id}`));
  });

  return app;
}

async function qrSvg(value: string): Promise<string> {
  return qrToString(value, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
}

/**
 * HTML-escapes a value.
 *
 * Merchant names, titles and metadata are attacker-controlled as far as this
 * page is concerned — a merchant account is created by whoever signs up.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; --bg: #ffffff; --fg: #101014; --muted: #5b5b66; --line: #e3e3e8; --accent: #1a1a1f; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0d0d10; --fg: #f2f2f5; --muted: #9a9aa6; --line: #26262d; --accent: #f2f2f5; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg);
         font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
         display: flex; justify-content: center; padding: 24px; }
  main { width: 100%; max-width: 26rem; }
  .card { border: 1px solid var(--line); border-radius: 14px; padding: 24px; }
  h1 { font-size: 1.05rem; margin: 0 0 4px; }
  .muted { color: var(--muted); font-size: 0.85rem; }
  .amount { font-size: 2rem; font-weight: 650; letter-spacing: -0.02em; margin: 16px 0; }
  .qr { display: flex; justify-content: center; padding: 12px; background: #fff; border-radius: 10px; }
  .qr svg, .qr img { width: 100%; height: auto; max-width: 220px; display: block; }
  .row { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0;
         border-top: 1px solid var(--line); font-size: 0.9rem; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.8rem; word-break: break-all; }
  button { width: 100%; padding: 12px 16px; border: 0; border-radius: 10px; cursor: pointer;
           background: var(--accent); color: var(--bg); font-size: 1rem; font-weight: 600; }
  button[disabled] { opacity: 0.5; cursor: not-allowed; }
  input { width: 100%; padding: 12px; border: 1px solid var(--line); border-radius: 10px;
          background: transparent; color: var(--fg); font-size: 1rem; }
  label { display: block; margin: 16px 0 6px; font-size: 0.85rem; color: var(--muted); }
</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

async function linkPage(link: PaymentLink, payable: boolean, url: string): Promise<string> {
  const title = link.title ?? link.merchant.name;
  const qr = await qrSvg(url);

  const amountBlock =
    link.amount === undefined
      ? `<label for="amount">Jumlah (${escapeHtml(link.currency ?? "")})</label>
         <input id="amount" inputmode="decimal" placeholder="0" ${link.kind === "open" ? "" : "disabled"}>`
      : `<div class="amount">${escapeHtml(formatMoneyLocale(link.amount))}</div>`;

  const body = `<div class="card">
  <h1>${escapeHtml(title)}</h1>
  <p class="muted">${escapeHtml(link.merchant.name)} · ${escapeHtml(link.merchant.city)}</p>
  ${amountBlock}
  <div class="qr">${qr}</div>
  <p class="muted" style="text-align:center">Pindai untuk membuka halaman ini</p>
  ${
    payable
      ? `<button id="pay">Bayar</button><p class="muted" id="error"></p>`
      : `<p class="muted">Tautan ini sudah tidak berlaku.</p>`
  }
</div>
<script>
  const button = document.getElementById("pay");
  if (button) {
    button.addEventListener("click", async () => {
      button.disabled = true;
      const input = document.getElementById("amount");
      const body = input && !input.disabled
        ? { amount: { amount: input.value, asset: ${JSON.stringify(link.currency ?? "")} } }
        : {};
      const response = await fetch(${JSON.stringify(`/payment-links/${link.id}/checkout`)}, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) {
        document.getElementById("error").textContent = payload?.error?.message ?? "Gagal membuat pembayaran";
        button.disabled = false;
        return;
      }
      location.href = "/checkout/pay/" + payload.paymentIntent.id;
    });
  }
</script>`;

  return shell(title, body);
}

function payPage(intentId: string, amount: Money, statusUrl: string): string {
  const body = `<div class="card">
  <h1>Pembayaran</h1>
  <p class="muted"><code>${escapeHtml(intentId)}</code></p>
  <div class="amount">${escapeHtml(formatMoneyLocale(amount))}</div>
  <div id="deposit"></div>
  <div class="row"><span>Status</span><strong id="status">memuat…</strong></div>
  <p class="muted">Halaman ini memeriksa status setiap ${POLL_MS / 1000} detik.</p>
</div>
<script>
  const statusUrl = ${JSON.stringify(statusUrl)};
  const done = ["COMPLETED", "FAILED", "EXPIRED"];

  async function refresh() {
    const response = await fetch(statusUrl);
    if (!response.ok) return;
    const payload = await response.json();
    document.getElementById("status").textContent = payload.paymentIntent.status;

    const deposit = payload.deposit;
    const target = document.getElementById("deposit");
    if (deposit && !target.dataset.rendered) {
      target.dataset.rendered = "1";
      const qr = deposit.uri
        ? '<div class="qr"><img alt="QR pembayaran" src="/checkout/qr?value=' +
          encodeURIComponent(deposit.uri) + '"></div>'
        : "";
      target.innerHTML =
        qr +
        '<div class="row"><span>Kirim</span><strong>' + deposit.amount.display + "</strong></div>" +
        '<div class="row"><span>Jaringan</span><strong>' + deposit.chain + "</strong></div>" +
        '<div class="row"><span>Alamat</span><code>' + deposit.address + "</code></div>";
    }
    if (done.includes(payload.paymentIntent.status)) clearInterval(timer);
  }

  const timer = setInterval(refresh, ${POLL_MS});
  refresh();
</script>`;

  return shell(`Pembayaran ${intentId}`, body);
}
