/**
 * Headers the Cloudflare dashboard's same-origin API proxy passes through (SEC-03).
 *
 * Both directions are an allowlist: a header the API does not read is a header
 * an attacker can use to spoof (`x-forwarded-*`) or leak (`cf-*`, platform
 * internals), so nothing travels unless it is named here.
 */
const REQUEST_HEADERS = [
  "accept",
  "accept-language",
  "authorization",
  "content-type",
  "cookie",
  "idempotency-key",
  "user-agent",
  "x-csrf-token",
];

const RESPONSE_HEADERS = [
  "cache-control",
  "content-disposition",
  "content-type",
  "etag",
  "location",
  "retry-after",
  "set-cookie",
];

function pick(source: Headers, names: readonly string[]): Headers {
  const headers = new Headers();
  for (const name of names) {
    // `set-cookie` can repeat; `getSetCookie` is the only lossless read.
    if (name === "set-cookie") {
      for (const value of source.getSetCookie()) headers.append(name, value);
      continue;
    }
    const value = source.get(name);
    if (value !== null) headers.set(name, value);
  }
  return headers;
}

export function apiProxyHeaders(
  incoming: Headers,
  extra: Readonly<Record<string, string>> = {},
): Headers {
  const headers = pick(incoming, REQUEST_HEADERS);
  // Ours, never the visitor's: set after the allowlist, so a visitor sending the
  // same header gets nothing through it.
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);

  // The next hop is another hostname in this Cloudflare zone. Cloudflare
  // derives that hop's `CF-Connecting-IP` from `x-real-ip`, so stamp the
  // original visitor explicitly instead of letting a changing Worker egress
  // address split one browser across multiple rate-limit buckets.
  const clientIp = incoming.get("cf-connecting-ip")?.trim();
  if (clientIp !== undefined && clientIp !== "") headers.set("x-real-ip", clientIp);

  return headers;
}

export function apiProxyResponseHeaders(upstream: Headers): Headers {
  return pick(upstream, RESPONSE_HEADERS);
}
