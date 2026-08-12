/**
 * `<mayarin-checkout>` — the hosted checkout on a merchant's page (#113).
 *
 * Two modes, decided by the attributes:
 *
 * - `link` — frame the hosted checkout for an existing payment link. No key;
 *   a link id is an unguessable ULID, the same posture the hosted page takes.
 * - `cart` + `publishable-key` — mint a payment from cart lines through the
 *   publishable surface, confirm it (which locks the price and allocates the
 *   deposit address), then frame the pay page.
 *
 * The isolation model is the iframe, not the shadow root. The frame is
 * cross-origin to the merchant's page, so the merchant's CSS cannot reach into
 * the checkout and the checkout's DOM cannot read the merchant's page — the
 * browser enforces both. The shadow root only keeps the host element's own
 * styling (sizing, the error message) out of the merchant's cascade.
 */

import {
  type CartEmbedConfig,
  cartCheckoutPlan,
  checkoutUrl,
  parseEmbedConfig,
  payUrl,
} from "./config.ts";

/**
 * `allow-same-origin` + `allow-scripts` is safe here because the framed page is
 * the Mayarin checkout on the API's origin, never merchant content: the pair
 * only "escapes" a sandbox when the framed document shares the embedder's
 * origin. `allow-forms` for the pay flow, `allow-popups` (escaping the sandbox)
 * so a wallet deep link or explorer link opens in a working tab.
 */
const SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox";

export class MayarinCheckoutElement extends HTMLElement {
  static readonly observedAttributes = [
    "base-url",
    "link",
    "cart",
    "publishable-key",
    "height",
  ] as const;

  readonly #root: ShadowRoot;
  /** Bumped per render; a stale async mint must not paint over a newer one. */
  #renderToken = 0;

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: "open" });
  }

  connectedCallback(): void {
    this.#render();
  }

  attributeChangedCallback(): void {
    if (this.isConnected) this.#render();
  }

  #render(): void {
    const token = ++this.#renderToken;
    try {
      const config = parseEmbedConfig({
        baseUrl: this.getAttribute("base-url"),
        link: this.getAttribute("link"),
        cart: this.getAttribute("cart"),
        publishableKey: this.getAttribute("publishable-key"),
        height: this.getAttribute("height"),
      });
      if (config.mode === "link") {
        this.#paint(token, frame(checkoutUrl(config), config.height));
        return;
      }
      // Buyer-visible while the mint runs; errors below are for the merchant.
      this.#paint(token, notice("Menyiapkan pembayaran…"));
      void this.#mintAndFrame(config, token);
    } catch (error) {
      // The message is for the merchant wiring the embed, not the buyer: a
      // visible sentence beats a blank box that looks like an outage.
      this.#paint(token, notice(messageOf(error), "alert"));
    }
  }

  async #mintAndFrame(config: CartEmbedConfig, token: number): Promise<void> {
    try {
      const plan = cartCheckoutPlan(config);
      const minted = await postJson(plan.mintUrl, plan.headers, plan.body);
      const intentId = intentIdOf(minted);
      const confirmed = await postJson(plan.confirmUrl(intentId), plan.headers, {});
      failIfUnpayable(confirmed);
      this.#paint(token, frame(payUrl(config, intentId), config.height));
    } catch (error) {
      this.#paint(token, notice(messageOf(error), "alert"));
    }
  }

  #paint(token: number, markup: string): void {
    if (token !== this.#renderToken) return;
    this.#root.innerHTML = `<style>${STYLE}</style>${markup}`;
  }
}

async function postJson(
  url: string,
  headers: Readonly<Record<string, string>>,
  body: unknown,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { ...headers },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("mayarin-checkout: the payment API is unreachable.");
  }
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new Error(
      apiMessageOf(payload) ?? `mayarin-checkout: the payment API answered ${response.status}.`,
    );
  }
  return (payload ?? {}) as Record<string, unknown>;
}

function intentIdOf(payload: Record<string, unknown>): string {
  const intent = payload["paymentIntent"];
  const id =
    intent !== null && typeof intent === "object"
      ? (intent as Record<string, unknown>)["id"]
      : undefined;
  if (typeof id !== "string" || id === "") {
    throw new Error("mayarin-checkout: the mint answered without a payment intent id.");
  }
  return id;
}

/** A payment that fails to price answers 200 with a FAILED intent. */
function failIfUnpayable(payload: Record<string, unknown>): void {
  const intent = payload["paymentIntent"];
  if (intent === null || typeof intent !== "object") return;
  const record = intent as Record<string, unknown>;
  if (record["status"] !== "FAILED") return;
  const reason = record["failureReason"];
  throw new Error(
    typeof reason === "string" && reason !== ""
      ? reason
      : "mayarin-checkout: the payment could not be priced.",
  );
}

/** Pulls the human message out of the API's `{ error: { message } }`. */
function apiMessageOf(payload: unknown): string | undefined {
  if (payload === null || typeof payload !== "object" || !("error" in payload)) return undefined;
  const error = (payload as { error: unknown }).error;
  if (error === null || typeof error !== "object" || !("message" in error)) return undefined;
  const message = (error as { message: unknown }).message;
  return typeof message === "string" ? message : undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const STYLE = `
:host { display: block; width: 100%; }
iframe { display: block; width: 100%; border: 0; }
p { font: 14px/1.5 system-ui, sans-serif; margin: 0; padding: 12px 16px;
    border: 1px solid currentColor; border-radius: 6px; }
`;

function frame(src: string, height: string): string {
  return (
    `<iframe src="${escapeAttribute(src)}" title="Mayarin checkout"` +
    ` style="height:${escapeAttribute(height)}"` +
    ` sandbox="${SANDBOX}" allow="clipboard-write" referrerpolicy="no-referrer"></iframe>`
  );
}

function notice(message: string, role?: "alert"): string {
  return `<p${role === undefined ? "" : ' role="alert"'}>${escapeText(message)}</p>`;
}

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', "&quot;");
}
