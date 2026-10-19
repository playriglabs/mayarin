/**
 * The payer's capability to one payment (SEC-09).
 *
 * A payment id is an identifier, not a credential: it shows up in dashboards,
 * webhooks, support threads and logs. What lets a buyer open the checkout, watch
 * the status or fetch the receipt is this token, minted when the payment is
 * created and handed back only to whoever created it.
 *
 * Stateless: `<expiry>.<HMAC(key, id.expiry)>`. It names one payment and dies
 * on its own, so a leaked link opens one payment for a bounded time and
 * nothing else. There is no per-token revocation; rotating `PAYER_TOKEN_KEY`
 * revokes every token at once, which is the lever for an incident.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** The one thing a token needs from a clock; `@mayarin/shared` clocks fit. */
interface Clock {
  now(): Date;
}

export interface PayerTokensOptions {
  readonly key: string;
  readonly ttlSeconds: number;
  readonly clock: Clock;
}

export class PayerTokens {
  readonly #key: string;
  readonly #ttlSeconds: number;
  readonly #clock: Clock;

  constructor(options: PayerTokensOptions) {
    this.#key = options.key;
    this.#ttlSeconds = options.ttlSeconds;
    this.#clock = options.clock;
  }

  mint(paymentId: string): string {
    const expiry = Math.floor(this.#clock.now().getTime() / 1000) + this.#ttlSeconds;
    return `${expiry}.${this.#sign(paymentId, expiry)}`;
  }

  verify(paymentId: string, token: string | undefined): boolean {
    if (token === undefined) return false;
    const [expiryText, signature] = token.split(".");
    const expiry = Number(expiryText);
    if (signature === undefined || !Number.isSafeInteger(expiry)) return false;
    if (expiry <= Math.floor(this.#clock.now().getTime() / 1000)) return false;
    const expected = Buffer.from(this.#sign(paymentId, expiry));
    const received = Buffer.from(signature);
    return expected.length === received.length && timingSafeEqual(expected, received);
  }

  #sign(paymentId: string, expiry: number): string {
    return createHmac("sha256", this.#key)
      .update(`payer:${paymentId}:${expiry}`)
      .digest("base64url");
  }
}
