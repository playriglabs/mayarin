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

export interface EmbedConfig {
  /** Origin of the payment API, e.g. `https://api.mayarin.xyz`. */
  readonly baseUrl: string;
  /** The payment link id the hosted checkout renders. */
  readonly linkId: string;
  /** CSS height for the frame. */
  readonly height: string;
}

/** Raw attribute values as the DOM hands them over: `null` when absent. */
export interface EmbedAttributes {
  readonly baseUrl: string | null;
  readonly link: string | null;
  readonly height: string | null;
}

const DEFAULT_HEIGHT = "640px";

export function parseEmbedConfig(attributes: EmbedAttributes): EmbedConfig {
  const baseUrl = requireAttribute(attributes.baseUrl, "base-url");
  const linkId = requireAttribute(attributes.link, "link");

  const parsed = parseHttpUrl(baseUrl);
  if (parsed === undefined) {
    throw new Error(`mayarin-checkout: base-url must be an http(s) origin, got "${baseUrl}".`);
  }

  return {
    baseUrl: parsed,
    linkId,
    height: normalizeHeight(attributes.height),
  };
}

/** `${baseUrl}/checkout/${linkId}` — the buyer page, unversioned forever (#138). */
export function checkoutUrl(config: EmbedConfig): string {
  return `${config.baseUrl}/checkout/${encodeURIComponent(config.linkId)}`;
}

function requireAttribute(value: string | null, name: string): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") {
    throw new Error(`mayarin-checkout: the "${name}" attribute is required.`);
  }
  return trimmed;
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
