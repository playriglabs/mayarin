/**
 * The dashboard's client for the payment API (#15).
 *
 * Minting a payment needs the clearing engine, the rate sources and the token
 * registry — the whole pipeline `apps/api` composes. The dashboard deliberately
 * does not build a second copy of it: a duplicate of "what must a payer send"
 * is a duplicate that drifts, and the value it decides is money leaving a
 * buyer's wallet. So the dashboard asks the service that owns the answer, over
 * exactly the routes a third-party integration would use.
 *
 * That is not a shortcut around the layering, it is the layering: the docs say
 * the contract boundary is the Payment Intent and that a storefront or POS is
 * built on the payment primitives. The dashboard is the first such POS.
 *
 * Every call is server-to-server. Nothing here is reachable from a browser, and
 * the caller has already been authenticated and scoped by the route.
 */

import { ProviderError } from "@mayarin/shared";

export interface PaymentRail {
  readonly asset: string;
  readonly chain: string;
}

export interface CheckoutLinkRequest {
  readonly linkId: string;
  /** Required by an `open` link, refused by the others — they price themselves. */
  readonly amount?: { readonly amount: string; readonly asset: string };
  readonly payment: PaymentRail;
  /** Stamped onto the minted intent's `metadata`, e.g. a `customerId` link. */
  readonly metadata?: Readonly<Record<string, string>>;
  /** The merchant's own order id, copied onto the intent. */
  readonly merchantReference?: string;
}

/**
 * What a payer must send, as the payment API reports it.
 *
 * Passed through rather than re-shaped: the payment API already renders every
 * field the way a payer is meant to read it, and a second opinion here would be
 * a second thing to keep in step.
 */
export interface DepositView {
  readonly address: string;
  readonly chain: string;
  readonly asset: string;
  readonly amount: {
    readonly amount: string;
    readonly display: string;
    readonly formatted: string;
  };
  /** EIP-681 URI to render as a QR. `null` when the asset names nothing transferable. */
  readonly uri: string | null;
  readonly received: { readonly amount: string; readonly display: string };
  readonly required: number;
}

/**
 * What one accepted asset would cost the payer.
 *
 * `available: false` is a rate the provider could not give — no configured
 * pair, a source that is down, a closed market. Reported per asset rather than
 * failing the request, so one unpriceable asset does not blank the counter for
 * the others.
 */
export interface QuoteLine {
  readonly asset: string;
  readonly amount: { readonly amount: string; readonly display: string } | null;
  readonly available: boolean;
  /** Why it could not be priced. Present only on an unavailable line. */
  readonly reason?: string;
}

export interface QuoteView {
  readonly source: { readonly display: string };
  readonly quotes: readonly QuoteLine[];
  /** Always true: nothing here is locked. The lock happens at confirm. */
  readonly indicative: boolean;
}

export interface PaymentApiClientOptions {
  readonly baseUrl: string;
  /** Injected for tests; defaults to the platform `fetch`. */
  readonly fetch?: typeof fetch;
}

export class PaymentApiClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(options: PaymentApiClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#fetch = options.fetch ?? fetch;
  }

  /**
   * Mints a payment from a link and drives it to a locked price.
   *
   * `executionPath` is pinned to `deposit-match` rather than left to the
   * deployment default: this is the counter flow, where the payer holds a phone
   * wallet and a scanned QR can do exactly one thing — a plain transfer. The
   * contract path needs the payer to sign a transaction the dashboard cannot
   * put in front of them, and produces no address to scan at all.
   */
  async charge(request: CheckoutLinkRequest): Promise<{ paymentIntentId: string }> {
    const created = await this.#post<{ paymentIntent: { id: string } }>(
      `/payment-links/${encodeURIComponent(request.linkId)}/checkout`,
      {
        executionPath: "deposit-match",
        payment: request.payment,
        ...(request.amount === undefined ? {} : { amount: request.amount }),
        ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
        ...(request.merchantReference === undefined
          ? {}
          : { merchantReference: request.merchantReference }),
      },
    );

    // Confirming is what locks the price and allocates the address. Without it
    // the merchant would be shown a QR for a payment that has not been priced.
    const confirmed = await this.#post<{
      paymentIntent: { id: string; status: string; failureReason?: string | null };
    }>(`/payment-intents/${encodeURIComponent(created.paymentIntent.id)}/confirm`, {});

    // A payment that fails to price answers 200 with a FAILED intent: the
    // request was handled, the payment was not taken. Reported as a failure
    // here, because the alternative is handing the counter an id whose sheet
    // then shows "no address to scan" and no reason — and the reason is the
    // only part the merchant can act on.
    if (confirmed.paymentIntent.status === "FAILED") {
      throw new ProviderError(
        confirmed.paymentIntent.failureReason ?? "The payment could not be priced",
        { paymentIntentId: confirmed.paymentIntent.id },
        { retryable: false },
      );
    }

    return { paymentIntentId: created.paymentIntent.id };
  }

  /**
   * What each accepted asset would take, before any payment exists.
   *
   * Indicative: the payer is charged what their payment locks at confirm, and
   * the two can differ by whatever the rate moved in between. Shown so a
   * customer at a counter can choose what to pay with.
   */
  async quote(
    amount: { readonly amount: string; readonly asset: string },
    assets: readonly string[],
  ): Promise<QuoteView> {
    return this.#post<QuoteView>("/quotes", { amount, assets });
  }

  /** What the payer must send, or `null` before a price is locked. */
  async deposit(paymentIntentId: string): Promise<DepositView | null> {
    const payment = await this.#get<{ deposit?: DepositView | null }>(
      `/payments/${encodeURIComponent(paymentIntentId)}`,
    );
    return payment.deposit ?? null;
  }

  async #get<T>(path: string): Promise<T> {
    return this.#send<T>(path, { method: "GET" });
  }

  async #post<T>(path: string, body: unknown): Promise<T> {
    return this.#send<T>(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  /**
   * One place that talks to the payment API, so its failures reach the merchant
   * as one kind of error.
   *
   * A refusal from the payment API is reported with its own message: it is the
   * service that knows why a payment cannot be taken — no accepted asset, no
   * rate for the pair, a retired link — and restating that as "something went
   * wrong" would throw away the only useful sentence in the response.
   */
  async #send<T>(path: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, init);
    } catch (error) {
      throw new ProviderError(
        `The payment API is unreachable at ${this.#baseUrl}`,
        { path, cause: error instanceof Error ? error.message : String(error) },
        // Retryable: the service being down is a condition that passes.
        { retryable: true },
      );
    }

    const text = await response.text();
    const body: unknown = text === "" ? undefined : safeJson(text);

    if (!response.ok) {
      throw new ProviderError(
        messageOf(body) ?? "The payment API refused the request",
        { path, status: response.status },
        // A refusal is a decision, not a blip: retrying it produces the same
        // refusal and would only hide the reason behind a spinner.
        { retryable: false },
      );
    }
    return body as T;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Pulls the human message out of the payment API's `{ error: { message } }`. */
function messageOf(body: unknown): string | undefined {
  if (body === null || typeof body !== "object" || !("error" in body)) return undefined;
  const error = (body as { error: unknown }).error;
  if (error === null || typeof error !== "object" || !("message" in error)) return undefined;
  return String((error as { message: unknown }).message);
}
