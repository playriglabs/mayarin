/**
 * "Pay in local currency" is chosen on one page and acted on in the next: the
 * rail has to be confirmed, which reloads the payment page from the intent. This
 * is the one bit that crosses the reload, so the payment page leads with the
 * local-currency form instead of the crypto instructions.
 *
 * It outlives a refresh on purpose: a payer who reloads mid-payment should land
 * where they were, not be shown a crypto address they never asked for.
 *
 * `sessionStorage` can be absent or throw (private windows), and the flow works
 * without it — the payer simply sees the crypto instructions with the local
 * option folded below them.
 */

const KEY = "mayarin:local-currency";

export function rememberLocalCurrencyIntent(intentId: string): void {
  try {
    sessionStorage.setItem(KEY, intentId);
  } catch {
    // The page still works; it just leads with crypto.
  }
}

export function isLocalCurrencyIntent(intentId: string): boolean {
  try {
    return sessionStorage.getItem(KEY) === intentId;
  } catch {
    return false;
  }
}

export function forgetLocalCurrencyIntent(intentId: string): void {
  try {
    if (sessionStorage.getItem(KEY) === intentId) sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}
