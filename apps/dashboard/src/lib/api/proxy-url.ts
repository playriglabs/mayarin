/**
 * The upstream URL for the same-origin API proxy (SEC-03).
 *
 * The request path is attacker-controlled and the proxy forwards cookies and
 * authorization, so the target is built from the configured origin and only
 * ever assigned a pathname. `new URL("//evil.example/x", origin)` is the
 * mistake this exists to prevent: a protocol-relative path replaces the host.
 */
export function apiProxyUrl(pathname: string, search: string, apiOrigin: string): URL {
  const base = new URL(apiOrigin);

  // Normalised separators are how a path smuggles in a host or climbs out.
  if (!pathname.startsWith("/") || pathname.startsWith("//") || pathname.includes("\\")) {
    throw new RangeError("Invalid API path");
  }
  if (/%(?:2f|5c|2e)/i.test(pathname)) throw new RangeError("Invalid API path");

  const url = new URL(base);
  url.pathname = pathname;
  url.search = search;

  if (url.origin !== base.origin || url.username !== "" || url.password !== "") {
    throw new RangeError("Invalid API path");
  }
  // `..` is resolved by the URL parser; a path that left the API root was not
  // one the dashboard asked for.
  if (url.pathname !== pathname) throw new RangeError("Invalid API path");
  return url;
}
