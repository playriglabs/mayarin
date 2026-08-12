/**
 * The pure half of the embed: attribute parsing and URL assembly.
 *
 * Everything here is inputs → outputs so it tests without a DOM. The custom
 * element is a thin shell over these functions.
 *
 * A malformed configuration throws a plain `Error` with a sentence a merchant
 * can act on. The element catches it and renders the message instead of a
 * checkout — a visibly misconfigured embed is fixed the same afternoon; a
 * silently blank one ships (#113). Plain `Error` rather than the `MayarinError`
 * taxonomy on purpose: the embed is a zero-dependency browser artifact, and
 * nothing here is retryable.
 */

/** Raw attribute values as the DOM hands them over: `null` when absent. */
export interface EmbedAttributes {
  readonly baseUrl: string | null;
  readonly link: string | null;
  readonly cart: string | null;
  readonly publishableKey: string | null;
  readonly height: string | null;
}

interface EmbedConfigBase {
  /** Origin of the payment API, e.g. `https://api.mayarin.xyz`. */
  readonly baseUrl: string;
  /** CSS height for the frame. */
  readonly height: string;
}

/** `link` mode: the hosted checkout for an existing payment link. No key. */
export interface LinkEmbedConfig extends EmbedConfigBase {
  readonly mode: "link";
  readonly linkId: string;
}

/**
 * `cart` mode (#113): mint a payment from cart lines with a publishable key,
 * then frame the pay page. The cart names its payment rail — the pay page
 * shows a deposit to a rail already chosen, it has no asset picker. A
 * storefront that wants the buyer to choose renders one element per rail, or
 * uses a payment link.
 */
export interface CartEmbedConfig extends EmbedConfigBase {
  readonly mode: "cart";
  readonly publishableKey: string;
  readonly body: Readonly<Record<string, unknown>>;
}

export type EmbedConfig = LinkEmbedConfig | CartEmbedConfig;

const DEFAULT_HEIGHT = "640px";

export function parseEmbedConfig(attributes: EmbedAttributes): EmbedConfig {
  const rawBaseUrl = requireAttribute(attributes.baseUrl, "base-url");
  const baseUrl = parseHttpUrl(rawBaseUrl);
  if (baseUrl === undefined) {
    throw new Error(`mayarin-checkout: base-url must be an http(s) origin, got "${rawBaseUrl}".`);
  }
  const base: EmbedConfigBase = { baseUrl, height: normalizeHeight(attributes.height) };

  const link = attributes.link?.trim() ?? "";
  const cart = attributes.cart?.trim() ?? "";
  if (link !== "" && cart !== "") {
    throw new Error('mayarin-checkout: give "link" or "cart", not both.');
  }
  if (link !== "") {
    return { ...base, mode: "link", linkId: link };
  }
  if (cart !== "") {
    return {
      ...base,
      mode: "cart",
      publishableKey: requirePublishableKey(attributes),
      body: parseCart(cart),
    };
  }
  throw new Error(
    'mayarin-checkout: the "link" attribute (or "cart" + "publishable-key") is required.',
  );
}

/** `${baseUrl}/checkout/${linkId}` — the buyer page, unversioned forever (#138). */
export function checkoutUrl(config: LinkEmbedConfig): string {
  return `${config.baseUrl}/checkout/${encodeURIComponent(config.linkId)}`;
}

/** The pay page for a minted intent — also a buyer page, also unversioned. */
export function payUrl(config: CartEmbedConfig, intentId: string): string {
  return `${config.baseUrl}/checkout/pay/${encodeURIComponent(intentId)}`;
}

/**
 * The two requests cart mode sends, in order: mint, then confirm — the same
 * pair the hosted link page sends. Confirming is what locks the price and
 * allocates the deposit address; an unconfirmed intent has nothing to pay.
 */
export function cartCheckoutPlan(config: CartEmbedConfig): {
  readonly mintUrl: string;
  readonly confirmUrl: (intentId: string) => string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Readonly<Record<string, unknown>>;
} {
  return {
    mintUrl: `${config.baseUrl}/v1/carts/checkout`,
    confirmUrl: (intentId) =>
      `${config.baseUrl}/v1/payment-intents/${encodeURIComponent(intentId)}/confirm`,
    headers: {
      authorization: `Bearer ${config.publishableKey}`,
      "content-type": "application/json",
    },
    body: {
      ...config.body,
      // The pay page renders a deposit QR; the contract path has nothing to
      // scan. Same pinning, same reason, as the dashboard's counter flow.
      executionPath: config.body["executionPath"] ?? "deposit-match",
    },
  };
}

function requireAttribute(value: string | null, name: string): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") {
    throw new Error(`mayarin-checkout: the "${name}" attribute is required.`);
  }
  return trimmed;
}

function requirePublishableKey(attributes: EmbedAttributes): string {
  const key = requireAttribute(attributes.publishableKey, "publishable-key");
  // A secret key in browser markup is a leak the element refuses to ship.
  if (!key.startsWith("pk_")) {
    throw new Error('mayarin-checkout: "publishable-key" must be a pk_… key, never a secret.');
  }
  return key;
}

function parseCart(raw: string): Readonly<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('mayarin-checkout: the "cart" attribute is not valid JSON.');
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error('mayarin-checkout: the "cart" attribute must be a JSON object.');
  }
  const body = parsed as Record<string, unknown>;
  if (body["payment"] === undefined) {
    throw new Error(
      'mayarin-checkout: the cart must name its "payment" rail ({ asset, chain }) — ' +
        "the pay page has no asset picker. Render one element per rail to offer a choice.",
    );
  }
  return body;
}

/** The origin plus any path prefix, trailing slashes stripped. */
function parseHttpUrl(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

/** A bare number means pixels; anything else passes through as a CSS length. */
function normalizeHeight(value: string | null): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") return DEFAULT_HEIGHT;
  return /^\d+$/.test(trimmed) ? `${trimmed}px` : trimmed;
}
