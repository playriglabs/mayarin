/**
 * Hosted checkout (#10).
 *
 * Two pages a buyer sees and a merchant ships nothing to get: the link page,
 * which mints an intent, and the payment page, which shows what to pay and
 * where. Server-rendered, self-contained, no build step and no external assets
 * — a checkout that cannot render because a CDN is unreachable is a checkout
 * that loses the sale.
 *
 * Status is pushed over Server-Sent Events (#13) and polled as a fallback. The
 * poll is not dead code kept out of caution — it is the path a payer behind a
 * proxy that buffers streaming responses actually takes, and a payer who cannot
 * stream must still be able to pay.
 */

import { isLinkPayable, type LinkPreview, type PaymentLink } from "@mayarin/catalog";
import type { ChainId } from "@mayarin/chain";
import {
  type AssetCode,
  ConfigurationError,
  formatMoneyLocale,
  isAssetCode,
  type Money,
  NotFoundError,
  toDecimalString,
  ValidationError,
  zero,
} from "@mayarin/shared";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { toString as qrToString } from "qrcode";
import type { Container } from "../container.ts";

/**
 * The fallback poll interval.
 *
 * Only reached when the event stream cannot be opened or drops. Kept slow on
 * purpose: it is a safety net, not the primary path.
 */
const POLL_MS = 8_000;

/** How often a quiet stream writes, so an idle proxy does not close it. */
const KEEPALIVE_MS = 25_000;

/** Statuses after which nothing further will ever be sent. */
const TERMINAL_STATUSES: readonly string[] = ["COMPLETED", "FAILED", "EXPIRED"];

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

  /**
   * Live payment status (#13).
   *
   * Public, like the payment page it serves: an intent id is an unguessable
   * ULID, which is the same posture `GET /payments/:id` already takes. Anyone
   * holding the link can watch that one payment, and nothing else.
   *
   * The stream closes itself once the payment reaches a terminal state — there
   * is nothing further to send, and a socket held open past that point is a
   * socket held for no reason.
   */
  app.get("/events/:intentId", async (c) => {
    const stream = container.stream;
    if (stream === undefined) {
      // Not an error: the page falls back to polling, which still works.
      throw new NotFoundError("Live payment status is not enabled on this deployment", {});
    }

    const intentId = c.req.param("intentId");
    // Resolved before the stream opens, so an unknown id is a clean 404 rather
    // than an open connection that never sends anything.
    const { intent } = await container.paymentApp.getPayment(intentId);

    return streamSSE(c, async (sse) => {
      let closed = false;
      const send = async (event: string, data: string) => {
        if (closed) return;
        await sse.writeSSE({ event, data });
      };

      await send("payment", intent.status);

      const unwatch = stream.watch(intent.id, () => {
        // Fire-and-forget: the browser re-reads the payment, so a dropped nudge
        // costs one poll-interval of latency rather than a wrong status.
        void send("payment", "changed");
      });

      if (unwatch === undefined) {
        // At the process ceiling. Close immediately so the page falls back to
        // polling instead of holding a stream that will never fire.
        closed = true;
        await sse.close();
        return;
      }

      sse.onAbort(() => {
        closed = true;
        unwatch();
      });

      // Held open until the client goes away or the payment is terminal. The
      // keep-alive is what stops an idle proxy closing a quiet connection.
      while (!closed) {
        await sse.sleep(KEEPALIVE_MS);
        if (closed) break;
        const current = await container.paymentApp.getPayment(intent.id);
        if (TERMINAL_STATUSES.includes(current.intent.status)) {
          await send("payment", current.intent.status);
          closed = true;
          unwatch();
          await sse.close();
          return;
        }
        await sse.writeSSE({ event: "ping", data: "" });
      }
    });
  });

  /** The payment page: amount, deposit address, QR, and streamed status. */
  app.get("/pay/:intentId", async (c) => {
    const intentId = c.req.param("intentId");
    const { intent } = await container.paymentApp.getPayment(intentId);
    const successUrl = checkoutSuccessUrl(intent.metadata.checkoutSuccessBaseUrl, intent.id);
    return c.html(
      payPage({
        intentId: intent.id,
        amount: intent.amount,
        merchant: intent.merchant,
        expiresAt: intent.expiresAt,
        statusUrl: `${baseUrl}/v1/payments/${intent.id}`,
        streaming: container.stream !== undefined,
        ...(successUrl === undefined ? {} : { successUrl }),
      }),
    );
  });

  /**
   * The link page: what is being sold, in what asset, and one button.
   *
   * Registered last because it is the catch-all: Hono matches in registration
   * order, so `/qr` and `/pay/:intentId` would otherwise be read as link ids.
   */
  app.get("/:linkId", async (c) => {
    const link = await container.catalog.getLink(c.req.param("linkId"));
    const payable = isLinkPayable(link, new Date());

    // A catalog link's total lives in the products, so the page cannot add it
    // up; an open link has no total until the buyer types one. Both are the
    // same call, and neither mints anything.
    const preview =
      link.kind === "open"
        ? undefined
        : await container.commerce.previewLink(link.id).catch(() => undefined);

    const policy = await container.merchantPolicies.policyFor(link.merchant.id);
    const accepted =
      policy?.acceptedAssets.length !== undefined && policy.acceptedAssets.length > 0
        ? policy.acceptedAssets
        : defaultPayerAssets(container);

    return c.html(
      linkPage({
        link,
        payable,
        preview,
        accepted,
        chain: depositChain(container),
        ttlSeconds: container.config.paymentIntentTtlSeconds,
      }),
    );
  });

  return app;
}

async function qrSvg(value: string): Promise<string> {
  return qrToString(value, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
}

/**
 * Where a payer is asked to send funds.
 *
 * One chain, taken from what this deployment configured tokens for. A page that
 * guessed would hand the payer an address on a chain nothing watches.
 */
function depositChain(container: Container): ChainId {
  const [first] = Object.keys(container.config.chainAssets) as ChainId[];
  const [native] = Object.keys(container.config.chainNativeAssets) as ChainId[];
  const chain = first ?? native;
  if (chain === undefined) {
    throw new ConfigurationError("This deployment has no chain configured to take payment on", {});
  }
  return chain;
}

/**
 * Payer assets for a merchant who has named none.
 *
 * Read from what this deployment can actually receive — the tokens it knows an
 * address for, plus each chain's own currency — rather than a hardcoded list.
 * An asset offered here that no watcher scans is a payer sending funds nothing
 * will ever notice.
 */
function defaultPayerAssets(container: Container): readonly AssetCode[] {
  const assets = new Set<AssetCode>();
  for (const tokens of Object.values(container.config.chainAssets)) {
    for (const asset of Object.keys(tokens ?? {})) {
      if (isAssetCode(asset)) assets.add(asset);
    }
  }
  for (const native of Object.values(container.config.chainNativeAssets)) {
    if (native !== undefined) assets.add(native);
  }
  return [...assets];
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

/**
 * The page shell — the product's identity, inlined.
 *
 * The landing page and the dashboard share one look: paper and ink, square
 * corners, hairline rules, a four-step type scale, and one electric green kept
 * for state rather than decoration. This is the third surface and the only one
 * a buyer sees, so it carries the same rules instead of a generic card.
 *
 * Inlined and self-contained on purpose. A checkout that cannot render because
 * a font host is unreachable is a checkout that loses the sale, so the type
 * stack is the system's and there is not one external request on the page.
 */
function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root {
    color-scheme: light dark;
    --paper: #ffffff; --ink: #111111; --muted: #666666; --subtle: #9e9e9e;
    --line: #eaeaea; --field: #d4d4d4; --surface: #fafafa;
    --electric: #0eeb2e; --brand: #1f6f54; --danger: #b3261e;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --paper: #0a0a0a; --ink: #fafafa; --muted: #8a8a8a; --subtle: #616161;
      --line: #1e1e1e; --field: #2e2e2e; --surface: #111111;
      --brand: #31b285; --danger: #e5484d;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--paper); color: var(--ink);
    font: 14px/1.5 "Inter Tight", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    letter-spacing: -0.15px;
    display: flex; justify-content: center; padding: 24px 16px 48px;
    -webkit-font-smoothing: antialiased;
  }
  main { width: 100%; max-width: 26rem; }
  /* Square, everywhere. The whole system has one radius and it is zero. */
  .brand {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px; font-weight: 500; letter-spacing: 1.5px;
    color: var(--muted); text-transform: uppercase;
    display: flex; align-items: center; gap: 8px; margin-bottom: 20px;
  }
  .brand::before { content: ""; width: 8px; height: 8px; background: var(--electric); }
  .card { border: 1px solid var(--line); padding: 20px; }
  .card + .card { border-top: 0; }
  h1 { font-size: 24px; line-height: 30px; font-weight: 500; margin: 0; }
  h2 { font-size: 13px; font-weight: 500; margin: 0 0 12px; }
  .muted { color: var(--muted); font-size: 13px; margin: 4px 0 0; }
  .subtle { color: var(--subtle); font-size: 12px; }
  .figure { font-size: 24px; line-height: 30px; font-weight: 500; font-variant-numeric: tabular-nums; }
  .label { display: block; font-size: 12px; color: var(--muted); margin: 20px 0 6px; }
  .field { display: flex; align-items: center; border: 1px solid var(--field); }
  .field span {
    padding: 0 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px; color: var(--muted); border-right: 1px solid var(--line);
    align-self: stretch; display: flex; align-items: center;
  }
  input {
    flex: 1; min-width: 0; padding: 12px; border: 0; background: transparent;
    color: var(--ink); font: inherit; font-size: 24px; font-variant-numeric: tabular-nums;
  }
  input:focus { outline: 0; }
  .field:focus-within { outline: 2px solid var(--brand); outline-offset: -1px; }
  .assets { display: flex; flex-wrap: wrap; gap: 8px; }
  .asset {
    flex: 1 1 auto; padding: 10px 14px; border: 1px solid var(--field);
    background: transparent; color: var(--ink); font: inherit; cursor: pointer;
    text-align: center;
  }
  .asset[aria-pressed="true"] { border-color: var(--ink); background: var(--surface); }
  .rows { margin-top: 16px; }
  .row {
    display: flex; justify-content: space-between; align-items: baseline; gap: 12px;
    padding: 10px 0; border-top: 1px solid var(--line); font-size: 13px;
  }
  .row span { color: var(--muted); }
  .row strong { font-weight: 500; font-variant-numeric: tabular-nums; text-align: right; }
  button.primary {
    width: 100%; margin-top: 20px; padding: 13px 16px; border: 0; cursor: pointer;
    background: var(--ink); color: var(--paper); font: inherit; font-weight: 500;
  }
  button.primary[disabled] { opacity: 0.45; cursor: not-allowed; }
  .qr { display: flex; justify-content: center; padding: 12px; background: #fff; margin-top: 16px; }
  .qr svg, .qr img { width: 100%; height: auto; max-width: 200px; display: block; }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
    word-break: break-all; text-align: right;
  }
  .copy {
    border: 1px solid var(--field); background: transparent; color: var(--ink);
    font: inherit; font-size: 12px; padding: 4px 8px; cursor: pointer;
  }
  .status { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; }
  .dot { width: 8px; height: 8px; background: var(--muted); flex: none; }
  .dot.live { background: var(--electric); animation: pulse 1.6s ease-in-out infinite; }
  .dot.done { background: var(--brand); }
  .dot.bad { background: var(--danger); }
  @keyframes pulse { 50% { opacity: 0.25; } }
  .error { color: var(--danger); font-size: 13px; margin: 12px 0 0; }
  /* The outcome, once there is nothing left for the payer to do. Square like
     everything else, and the only place the brand green appears at size. */
  .outcome { text-align: center; padding: 12px 0 4px; }
  .mark {
    width: 44px; height: 44px; margin: 0 auto 16px; display: flex;
    align-items: center; justify-content: center; color: var(--paper);
    background: var(--brand);
  }
  .mark.bad { background: var(--danger); }
  .mark svg { width: 22px; height: 22px; display: block; }
  .outcome h2 { font-size: 18px; line-height: 24px; margin: 0 0 6px; }
  .outcome p { margin: 0; color: var(--muted); font-size: 13px; }
  @media (prefers-reduced-motion: reduce) { .dot.live { animation: none; } }
</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

interface LinkPageOptions {
  readonly link: PaymentLink;
  readonly payable: boolean;
  /** Priced lines and total, for a link that prices itself. Absent for `open`. */
  readonly preview: LinkPreview | undefined;
  readonly accepted: readonly AssetCode[];
  /** Where the payer sends funds. Named here so the intent is minted on the rail it will be watched on. */
  readonly chain: ChainId;
  readonly ttlSeconds: number;
}

/**
 * The link page: what is being bought, in what asset, and one button.
 *
 * Three things it deliberately does *not* do:
 *
 * - **No QR.** The QR that used to sit here encoded this page's own URL, on a
 *   page the buyer already had open. It belongs to the counter — a merchant
 *   turning a screen around — which is the dashboard's "Take payment", not the
 *   buyer's checkout.
 * - **No intent until the button.** An intent locks a price and allocates a
 *   deposit address, so minting one on page load would expire a lock while the
 *   buyer typed, and burn an address for everyone who merely opened the link.
 *   What the page owes the buyer is *saying so*, which the lock note does.
 * - **No price it cannot honour.** The estimate comes from `POST /quotes`,
 *   which reads the same rate provider the price lock will read, and is
 *   labelled as an estimate because the lock happens later.
 */
function linkPage(options: LinkPageOptions): string {
  const { link, payable, preview, accepted, ttlSeconds } = options;
  const title = link.title ?? link.merchant.name;
  const currency = link.currency ?? link.amount?.asset;
  const minutes = Math.max(1, Math.round(ttlSeconds / 60));

  const amountBlock =
    link.kind === "open"
      ? `<label class="label" for="amount">Jumlah</label>
         <div class="field">
           <span>${escapeHtml(currency ?? "")}</span>
           <input id="amount" inputmode="decimal" placeholder="0" autocomplete="off" autofocus>
         </div>`
      : `<div class="figure" style="margin-top:16px">${escapeHtml(
          formatMoneyLocale(preview?.total ?? link.amount ?? zero(currency ?? "IDR"), {
            trimTrailingZeros: true,
          }),
        )}</div>`;

  // Catalog lines, so a buyer can check what they are paying for before they
  // pay for it. A total with nothing behind it is a number to be taken on trust.
  // Only a catalog link has lines worth showing. A fixed or open link has one
  // synthetic line carrying the same figure the heading already shows.
  const lineRows =
    preview === undefined || link.kind !== "catalog"
      ? ""
      : `<div class="rows">${preview.lines
          .map(
            (line) =>
              `<div class="row"><span>${escapeHtml(line.name)} × ${line.quantity}</span><strong>${escapeHtml(
                formatMoneyLocale(line.unitPrice, { trimTrailingZeros: true }),
              )}</strong></div>`,
          )
          .join("")}</div>`;

  const assetButtons = accepted
    .map(
      (asset, index) =>
        `<button type="button" class="asset" data-asset="${escapeHtml(asset)}" aria-pressed="${
          index === 0 ? "true" : "false"
        }">${escapeHtml(asset)}</button>`,
    )
    .join("");

  const body = `<div class="brand">Mayarin</div>
<div class="card">
  <h1>${escapeHtml(title)}</h1>
  <p class="muted">${escapeHtml(link.merchant.name)} · ${escapeHtml(link.merchant.city)}</p>
  ${amountBlock}
  ${lineRows}
</div>
${
  payable
    ? `<div class="card">
  <h2>Bayar pakai</h2>
  <div class="assets">${assetButtons}</div>
  <div class="rows"><div class="row"><span>Perkiraan</span><strong id="estimate">—</strong></div></div>
  <p class="subtle">Perkiraan, bukan harga final. Harga dikunci ${minutes} menit begitu kamu menekan tombol di bawah.</p>
  <button class="primary" id="pay">Lanjut bayar</button>
  <p class="error" id="error"></p>
</div>`
    : `<div class="card"><p class="muted">Tautan ini sudah tidak berlaku.</p></div>`
}
<script>
  const currency = ${JSON.stringify(currency ?? null)};
  const input = document.getElementById("amount");
  const estimate = document.getElementById("estimate");
  const button = document.getElementById("pay");
  const error = document.getElementById("error");
  const fixedAmount = ${JSON.stringify(
    preview?.total === undefined ? null : toDecimalString(preview.total),
  )};
  let asset = ${JSON.stringify(accepted[0] ?? null)};
  let timer;

  function typedAmount() {
    return fixedAmount ?? (input ? input.value.trim() : "");
  }

  /**
   * Prices what the buyer will actually send.
   *
   * Debounced rather than fired per keystroke: the quote reads a live rate
   * source, and a request per character is a request per character.
   */
  function refreshEstimate() {
    if (estimate === null) return;
    const amount = typedAmount();
    if (currency === null || asset === null || amount === "" || Number(amount) <= 0) {
      estimate.textContent = "—";
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(async () => {
      estimate.textContent = "…";
      try {
        const response = await fetch("/v1/quotes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount: { amount, asset: currency }, assets: [asset] }),
        });
        const payload = await response.json();
        const line = payload?.quotes?.[0];
        estimate.textContent = line && line.available ? line.amount.display : "tidak tersedia";
      } catch {
        estimate.textContent = "tidak tersedia";
      }
    }, 400);
  }

  for (const choice of document.querySelectorAll(".asset")) {
    choice.addEventListener("click", () => {
      for (const other of document.querySelectorAll(".asset")) {
        other.setAttribute("aria-pressed", String(other === choice));
      }
      asset = choice.dataset.asset;
      refreshEstimate();
    });
  }

  if (input) input.addEventListener("input", refreshEstimate);
  refreshEstimate();

  if (button) {
    button.addEventListener("click", async () => {
      const amount = input && !input.disabled ? input.value.trim() : undefined;
      if (input && (amount === "" || Number(amount) <= 0)) {
        error.textContent = "Masukkan jumlah lebih dulu.";
        input.focus();
        return;
      }
      button.disabled = true;
      button.textContent = "Menyiapkan pembayaran…";
      error.textContent = "";

      const body = {
        ...(amount === undefined ? {} : { amount: { amount, asset: currency } }),
        ...(asset === null
          ? {}
          : {
              payment: { asset, chain: ${JSON.stringify(options.chain)} },
              // Pinned, not left to the deployment default: this page renders a
              // deposit address and a QR, and the contract path needs the
              // payer's own wallet to sign the router call. A page with no
              // wallet to connect cannot take that path whatever the default is.
              executionPath: "deposit-match",
            }),
      };

      function fail(message) {
        error.textContent = message;
        button.disabled = false;
        button.textContent = "Lanjut bayar";
      }

      try {
        const response = await fetch(${JSON.stringify(`/v1/payment-links/${link.id}/checkout`)}, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = await response.json();
        if (!response.ok) {
          fail(payload?.error?.message ?? "Gagal membuat pembayaran");
          return;
        }

        // Minting an intent does not lock a price or allocate a deposit
        // address — confirming it is what hands it to the clearing engine. The
        // payment page has nothing to show until this call has run, so it runs
        // here rather than after the redirect.
        const intentId = payload.paymentIntent.id;
        const confirmation = await fetch("/v1/payment-intents/" + intentId + "/confirm", {
          method: "POST",
        });
        const confirmed = await confirmation.json();
        if (!confirmation.ok) {
          fail(confirmed?.error?.message ?? "Gagal mengunci harga");
          return;
        }
        if (confirmed.paymentIntent.status === "FAILED") {
          fail(confirmed.paymentIntent.failureReason ?? "Harga tidak bisa dikunci");
          return;
        }

        location.href = "/checkout/pay/" + intentId;
      } catch {
        error.textContent = "Jaringan bermasalah. Coba lagi.";
        button.disabled = false;
        button.textContent = "Lanjut bayar";
      }
    });
  }
</script>`;

  return shell(title, body);
}

interface PayPageOptions {
  readonly intentId: string;
  readonly amount: Money;
  readonly merchant: { readonly name: string; readonly city: string };
  readonly expiresAt: Date;
  readonly statusUrl: string;
  readonly streaming: boolean;
  readonly successUrl?: string;
}

export function checkoutSuccessUrl(base: string | undefined, intentId: string): string | undefined {
  if (base === undefined) return undefined;
  try {
    const url = new URL(`${base.replace(/\/+$/, "")}/${encodeURIComponent(intentId)}`);
    return url.protocol === "https:" || url.hostname === "localhost" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The payment page: exactly what to send, where, and how long is left.
 *
 * The countdown is the part a payer cannot do without. A price lock expires,
 * and a payer who sends the asset a minute after it did has sent funds against
 * a payment that will not accept them — so the expiry is on the screen from the
 * first render rather than discovered when the status flips.
 */
function payPage(options: PayPageOptions): string {
  const { intentId, amount, merchant, expiresAt, statusUrl, streaming, successUrl } = options;

  const body = `<div class="brand">Mayarin</div>
<div class="card">
  <h1>${escapeHtml(formatMoneyLocale(amount, { trimTrailingZeros: true }))}</h1>
  <p class="muted">${escapeHtml(merchant.name)} · ${escapeHtml(merchant.city)}</p>
  <div class="rows">
    <div class="row"><span>Status</span><strong class="status"><i class="dot" id="dot"></i><span id="status" style="color:var(--ink)">memuat…</span></strong></div>
    <div class="row"><span>Berlaku sampai</span><strong id="countdown">—</strong></div>
  </div>
</div>
<div class="card" id="deposit">
  <h2>Menyiapkan alamat pembayaran…</h2>
  <p class="subtle">Harga sedang dikunci. Jangan tutup halaman ini.</p>
</div>
<p class="subtle" id="mode" style="margin-top:12px"></p>
<p class="subtle"><code>${escapeHtml(intentId)}</code></p>
<script>
  const statusUrl = ${JSON.stringify(statusUrl)};
  const expiresAt = ${JSON.stringify(expiresAt.toISOString())};
  const done = ["COMPLETED", "FAILED", "EXPIRED"];
  const successUrl = ${JSON.stringify(successUrl ?? null)};

  /**
   * Status in the payer's own terms.
   *
   * A payer does not know what PROCESSING means, and the machine's own names
   * are the wrong vocabulary for the one screen where somebody is deciding
   * whether their money arrived.
   */
  const WORDING = {
    PENDING: ["menunggu pembayaran", "live"],
    CONFIRMED: ["dana terdeteksi", "live"],
    PROCESSING: ["sedang diproses", "live"],
    COMPLETED: ["pembayaran selesai", "done"],
    FAILED: ["pembayaran gagal", "bad"],
    EXPIRED: ["masa berlaku habis", "bad"],
  };

  function tick() {
    const left = new Date(expiresAt).getTime() - Date.now();
    const node = document.getElementById("countdown");
    if (left <= 0) {
      node.textContent = "kedaluwarsa";
      return;
    }
    const total = Math.floor(left / 1000);
    node.textContent = String(Math.floor(total / 60)).padStart(2, "0") + ":" +
      String(total % 60).padStart(2, "0");
  }

  function renderDeposit(deposit) {
    const target = document.getElementById("deposit");
    if (target.dataset.rendered === "1") return;
    target.dataset.rendered = "1";
    const qr = deposit.uri
      ? '<div class="qr"><img alt="QR pembayaran" src="/checkout/qr?value=' +
        encodeURIComponent(deposit.uri) + '"></div>'
      : "";
    target.innerHTML =
      '<h2>Kirim tepat sejumlah ini</h2>' +
      '<div class="figure">' + deposit.amount.display + "</div>" +
      qr +
      '<div class="rows">' +
      '<div class="row"><span>Jaringan</span><strong>' + deposit.chain + "</strong></div>" +
      '<div class="row"><span>Alamat</span><code id="address">' + deposit.address + "</code></div>" +
      '<div class="row"><span>Sudah diterima</span><strong id="received">' + deposit.received.display + "</strong></div>" +
      "</div>" +
      '<button class="copy" id="copy" style="margin-top:12px">Salin alamat</button>' +
      '<p class="subtle" style="margin-top:12px">Kurang dari jumlah di atas tidak akan menyelesaikan pembayaran.</p>';

    document.getElementById("copy").addEventListener("click", async () => {
      await navigator.clipboard.writeText(deposit.address);
      document.getElementById("copy").textContent = "Tersalin";
    });
  }

  /**
   * The end of the payment, in place of the deposit card.
   *
   * A finished payment must stop asking to be paid. Leaving the QR and the
   * address on screen invites a second transfer to an address that will not
   * clear it — the same mistake in the failed and expired case as in the paid
   * one, so all three replace the card rather than only the happy path.
   */
  function renderOutcome(status) {
    const target = document.getElementById("deposit");
    if (target.dataset.outcome === status) return;
    target.dataset.outcome = status;
    // Set so a late poll cannot paint the deposit card back over the outcome.
    target.dataset.rendered = "1";

    const paid = status === "COMPLETED";
    const glyph = paid
      ? '<path d="M2 8.5 L6.5 13 L14 3" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"/>'
      : '<path d="M3 3 L13 13 M13 3 L3 13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"/>';
    const heading = paid
      ? "Pembayaran selesai"
      : status === "EXPIRED"
        ? "Masa berlaku habis"
        : "Pembayaran gagal";
    // Deliberately not the engine's own failure reason: that string names
    // clearing transactions and executor attempts, which is a sentence for an
    // operator reading the dashboard, not for the person holding the phone.
    const note = paid
      ? "Terima kasih sudah membayar. Kamu boleh menutup halaman ini."
      : "Mulai pembayaran baru untuk mencoba lagi.";

    target.innerHTML =
      '<div class="outcome">' +
      '<div class="mark' + (paid ? "" : " bad") + '">' +
      '<svg viewBox="0 0 16 16" aria-hidden="true">' + glyph + "</svg>" +
      "</div>" +
      "<h2>" + heading + "</h2>" +
      "<p>" + note + "</p>" +
      "</div>";
  }

  async function refresh() {
    const response = await fetch(statusUrl);
    if (!response.ok) return;
    const payload = await response.json();
    const status = payload.paymentIntent.status;
    const [text, tone] = WORDING[status] ?? [status.toLowerCase(), ""];
    document.getElementById("status").textContent = text;
    document.getElementById("dot").className = "dot " + tone;

    if (done.includes(status)) {
      renderOutcome(status);
      // The deadline is the payer's; once the payment is decided there is
      // nothing left to be in time for, so a running clock only misleads.
      document.getElementById("countdown").textContent = "—";
      stopEverything();
      if (status === "COMPLETED" && successUrl !== null) {
        setTimeout(() => location.assign(successUrl), 600);
      }
      return;
    }

    if (payload.deposit) {
      renderDeposit(payload.deposit);
      const received = document.getElementById("received");
      if (received) received.textContent = payload.deposit.received.display;
    }
  }

  let timer;
  let stream;
  const clock = setInterval(tick, 1000);
  tick();

  function stopEverything() {
    if (timer !== undefined) clearInterval(timer);
    if (stream !== undefined) stream.close();
    clearInterval(clock);
  }

  function startPolling(reason) {
    if (timer !== undefined) return;
    document.getElementById("mode").textContent = reason;
    timer = setInterval(refresh, ${POLL_MS});
  }

  refresh();

  if (${streaming ? "true" : "false"} && "EventSource" in window) {
    stream = new EventSource(${JSON.stringify(`/checkout/events/${intentId}`)});
    stream.addEventListener("open", () => {
      document.getElementById("mode").textContent = "Diperbarui otomatis.";
    });
    stream.addEventListener("payment", refresh);
    // Falls back rather than retrying forever: EventSource reconnects on its
    // own, but a proxy that buffers the stream would leave the page silent.
    stream.addEventListener("error", () => {
      startPolling("Memeriksa status berkala.");
    });
  } else {
    startPolling("Memeriksa status berkala.");
  }
</script>`;

  return shell(`Pembayaran ${intentId}`, body);
}
