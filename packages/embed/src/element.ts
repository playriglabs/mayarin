/**
 * `<mayarin-checkout>` — the hosted checkout on a merchant's page (#113).
 *
 * The isolation model is the iframe, not the shadow root. The frame is
 * cross-origin to the merchant's page, so the merchant's CSS cannot reach into
 * the checkout and the checkout's DOM cannot read the merchant's page — the
 * browser enforces both. The shadow root only keeps the host element's own
 * styling (sizing, the error message) out of the merchant's cascade.
 *
 * The element renders a payment link's hosted checkout by id. It holds no key:
 * a link id is an unguessable ULID, the same posture the hosted page itself
 * takes. Minting a checkout from a cart payload waits on publishable keys.
 */

import { checkoutUrl, parseEmbedConfig } from "./config.ts";

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
  static readonly observedAttributes = ["base-url", "link", "height"] as const;

  readonly #root: ShadowRoot;

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
    let markup: string;
    try {
      const config = parseEmbedConfig({
        baseUrl: this.getAttribute("base-url"),
        link: this.getAttribute("link"),
        height: this.getAttribute("height"),
      });
      markup = frame(checkoutUrl(config), config.height);
    } catch (error) {
      // The message is for the merchant wiring the embed, not the buyer: a
      // visible sentence beats a blank box that looks like an outage.
      markup = notice(error instanceof Error ? error.message : String(error));
    }
    this.#root.innerHTML = `<style>${STYLE}</style>${markup}`;
  }
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

function notice(message: string): string {
  return `<p role="alert">${escapeText(message)}</p>`;
}

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', "&quot;");
}
