/** Human-facing 402 page for someone opening the paid endpoint in a browser. */

import type { X402GateDecision } from "@mayarin/sdk";
import type { X402ConnectOptions } from "@mayarin/sdk/x402/connect";

type PaymentRequiredDecision = Extract<X402GateDecision, { readonly kind: "payment-required" }>;
type PaymentRequiredView = NonNullable<X402ConnectOptions["paymentRequiredView"]>;

const TOKEN_DECIMALS: Readonly<Record<string, number>> = {
  EURC: 6,
  USDC: 6,
};

const NETWORK_NAMES: Readonly<Record<string, string>> = {
  "eip155:84532": "Base Sepolia",
};

export const paymentRequiredView: PaymentRequiredView = (decision, req) => {
  const accepts = req.headers.accept;
  if (typeof accepts !== "string" || !accepts.includes("text/html")) return undefined;
  return {
    body: renderPaymentRequiredPage(decision),
    contentType: "text/html; charset=utf-8",
  };
};

export function renderPaymentRequiredPage(decision: PaymentRequiredDecision): string {
  const required = decision.paymentRequired;
  const description = required.resource.description ?? "A private report for paid subscribers.";
  const rails = required.accepts.map((accept) => {
    const token = tokenName(accept.extra, accept.asset);
    return {
      amount: displayAmount(accept.amount, token),
      network: NETWORK_NAMES[accept.network] ?? accept.network,
      token,
    };
  });

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src https://cdn.jsdelivr.net; style-src 'unsafe-inline' https://cdn.jsdelivr.net; font-src https://cdn.jsdelivr.net; base-uri 'none'; form-action 'none'" />
    <title>Premium access required · Mayarin</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/inter@5/index.css" />
    <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  </head>
  <body class="min-h-screen min-w-80 bg-[#f1f1ef] font-['Inter',ui-sans-serif,sans-serif] text-zinc-950 antialiased">
    <div class="mx-auto w-full max-w-6xl px-3 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
      <nav class="flex min-h-12 items-center justify-between px-1" aria-label="Mayarin">
        <span class="rounded-full border border-zinc-200 bg-white px-3 py-2 font-mono text-[11px] font-medium text-zinc-600">HTTP 402 · x402 v${required.x402Version}</span>
      </nav>
      <main class="mt-4 overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)] lg:grid lg:min-h-[680px] lg:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)]">
        <article class="relative flex min-h-[430px] flex-col overflow-hidden p-7 sm:p-10 lg:min-h-0 lg:p-14" aria-labelledby="story-title">
          <div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
            <span class="h-2 w-2 rounded-full bg-zinc-950"></span>
            Premium report
          </div>
          <h1 id="story-title" class="mt-8 max-w-[10ch] text-[clamp(3rem,7vw,5.75rem)] font-semibold leading-[0.94] tracking-[-0.065em]">The signal behind the noise.</h1>
          <p class="mt-7 max-w-lg text-base leading-7 text-zinc-600 sm:text-lg">${escapeHtml(description)}</p>
          <div class="mt-auto pt-14" aria-hidden="true">
            <div class="mb-5 flex items-center justify-between border-b border-zinc-200 pb-3 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-400">
              <span>Market intelligence</span><span>Members only</span>
            </div>
            <div class="grid select-none gap-3 opacity-45 blur-[3px]">
              <span class="h-2.5 w-full rounded-full bg-zinc-300"></span>
              <span class="h-2.5 w-[88%] rounded-full bg-zinc-300"></span>
              <span class="h-2.5 w-[72%] rounded-full bg-zinc-300"></span>
              <span class="h-2.5 w-[91%] rounded-full bg-zinc-300"></span>
            </div>
          </div>
        </article>
        <aside class="flex flex-col justify-center border-t border-zinc-200 bg-zinc-50/70 p-7 sm:p-10 lg:border-t-0 lg:border-l lg:p-12" aria-labelledby="paywall-title">
          <span class="grid h-12 w-12 place-items-center rounded-full border border-zinc-200 bg-white text-zinc-950" aria-hidden="true">
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14v2"/></svg>
          </span>
          <h2 id="paywall-title" class="mt-7 text-[clamp(2rem,4vw,2.75rem)] font-semibold leading-none tracking-[-0.055em]">Unlock this content</h2>
          <p class="mt-4 max-w-md text-[15px] leading-6 text-zinc-600">Pay once with an x402-compatible client. No account, subscription, or checkout form required.</p>
          <div class="my-8 flex items-baseline gap-2 border-y border-zinc-200 py-6">
            <strong class="text-4xl font-semibold tracking-[-0.055em]">$1.00</strong>
            <span class="text-sm text-zinc-500">per request</span>
          </div>
          <p class="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Choose a payment rail</p>
          <ul class="grid gap-2.5" aria-label="Accepted payment rails">
            ${rails.map(renderRail).join("\n            ")}
          </ul>
          <div class="mt-6 flex items-start gap-3 rounded-2xl border border-zinc-200 bg-white p-4 text-[13px] leading-5 text-zinc-600">
            <span class="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-zinc-950" aria-hidden="true"></span>
            <span>Your client will retry this request automatically with a payment signature. Content appears after settlement.</span>
          </div>
          <a class="mt-6 w-fit rounded-sm text-sm font-semibold underline decoration-zinc-300 underline-offset-4 transition-colors duration-200 hover:decoration-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-zinc-950 motion-reduce:transition-none" href="https://docs.mayarin.xyz/guides/x402">How x402 access works →</a>
        </aside>
      </main>
      <footer class="flex flex-col gap-2 px-1 pt-5 text-xs text-zinc-500 sm:flex-row sm:justify-between"><span>Protected by Mayarin</span><span>Price in fiat · settle in stablecoins</span></footer>
    </div>
  </body>
</html>`;
}

function tokenName(extra: Readonly<Record<string, unknown>> | undefined, address: string): string {
  const name = extra?.name;
  return typeof name === "string" && name !== "" ? name : shortAddress(address);
}

function displayAmount(atomic: string, token: string): string {
  const decimals = TOKEN_DECIMALS[token];
  if (decimals === undefined || !/^\d+$/.test(atomic)) return atomic;
  const digits = atomic.padStart(decimals + 1, "0");
  const whole = digits.slice(0, -decimals);
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  return fraction === "" ? whole : `${whole}.${fraction}`;
}

function renderRail(rail: {
  readonly amount: string;
  readonly network: string;
  readonly token: string;
}): string {
  return `<li class="flex min-h-16 items-center justify-between gap-4 rounded-2xl border border-zinc-200 bg-white px-4 py-3"><span class="grid gap-1"><strong class="text-sm font-semibold">${escapeHtml(rail.token)}</strong><span class="text-xs text-zinc-500">${escapeHtml(rail.network)}</span></span><span class="font-mono text-xs font-semibold text-zinc-800">${escapeHtml(rail.amount)} ${escapeHtml(rail.token)}</span></li>`;
}

function shortAddress(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
