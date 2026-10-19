/**
 * The payer's capability to one payment (SEC-09).
 *
 * The API puts it in the pay page's bootstrap and returns it when it mints a
 * payment; every request about that payment carries it as `?t=`. It is read
 * from the bootstrap here, not threaded through props, so a component that
 * fetches for the payment cannot forget it.
 */

export function bootstrapPayerToken(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const bootstrap = window.__BOOTSTRAP__;
  return bootstrap?.page === "pay" ? bootstrap.payerToken : undefined;
}

/** `url` with the token attached; unchanged when there is no token to attach. */
export function withPayerToken(url: string, token = bootstrapPayerToken()): string {
  if (token === undefined) return url;
  return `${url}${url.includes("?") ? "&" : "?"}t=${encodeURIComponent(token)}`;
}
