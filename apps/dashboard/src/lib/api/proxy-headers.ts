/** Headers forwarded by the Cloudflare dashboard's same-origin API proxy. */
export function apiProxyHeaders(incoming: Headers): Headers {
  const headers = new Headers(incoming);
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("x-real-ip");

  // The next hop is another hostname in this Cloudflare zone. Cloudflare
  // derives that hop's `CF-Connecting-IP` from `x-real-ip`, so stamp the
  // original visitor explicitly instead of letting a changing Worker egress
  // address split one browser across multiple rate-limit buckets.
  const clientIp = incoming.get("cf-connecting-ip")?.trim();
  if (clientIp !== undefined && clientIp !== "") headers.set("x-real-ip", clientIp);

  return headers;
}
