/**
 * The embeddable checkout (#113).
 *
 * One script tag, one element:
 *
 * ```html
 * <script type="module" src="https://your-host/mayarin-embed.js"></script>
 *
 * <!-- an existing payment link -->
 * <mayarin-checkout base-url="https://api.mayarin.xyz" link="plk_..."></mayarin-checkout>
 *
 * <!-- or mint from cart lines with a publishable key (#113) -->
 * <mayarin-checkout
 *   base-url="https://api.mayarin.xyz"
 *   publishable-key="pk_..."
 *   cart='{"merchant":{...},"currency":"IDR","lines":[...],"payment":{"asset":"USDC","chain":"base-sepolia"}}'
 * ></mayarin-checkout>
 * ```
 *
 * Importing the module registers the element. `register` is exported for a
 * bundler user who wants a different tag name or lazy registration.
 */

import { MayarinCheckoutElement } from "./element.ts";

export type {
  CartEmbedConfig,
  EmbedAttributes,
  EmbedConfig,
  LinkEmbedConfig,
} from "./config.ts";
export { cartCheckoutPlan, checkoutUrl, parseEmbedConfig, payUrl } from "./config.ts";
export { MayarinCheckoutElement } from "./element.ts";

export const DEFAULT_TAG_NAME = "mayarin-checkout";

/** Registers the element once; a second call (or a second script tag) is a no-op. */
export function register(tagName: string = DEFAULT_TAG_NAME): void {
  if (typeof customElements === "undefined") return;
  if (customElements.get(tagName) !== undefined) return;
  customElements.define(tagName, MayarinCheckoutElement);
}

register();
