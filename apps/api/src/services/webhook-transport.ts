/**
 * Fetch-backed webhook transport.
 *
 * The one concrete `WebhookTransport`, held in the composition layer so
 * `@mayarin/notifications` stays free of HTTP. A timeout turns a hanging
 * receiver into a failed attempt the backoff schedule owns; redirects are
 * refused because a delivery signed for one URL must not be replayed at
 * another.
 */

import type { WebhookRequest, WebhookResponse, WebhookTransport } from "@mayarin/notifications";

export class FetchWebhookTransport implements WebhookTransport {
  readonly #timeoutMs: number;

  constructor(options: { readonly timeoutMs?: number } = {}) {
    this.#timeoutMs = options.timeoutMs ?? 10_000;
  }

  async post(request: WebhookRequest): Promise<WebhookResponse> {
    const response = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: request.body,
      redirect: "error",
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    return { status: response.status };
  }
}
