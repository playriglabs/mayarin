/**
 * HTTP delivery port.
 *
 * Core signs and schedules; something concrete (a fetch adapter in the
 * composition root) moves the bytes. The port is deliberately one method wide
 * — a delivery is a POST, and everything else about it is the dispatcher's
 * business.
 */

export interface WebhookRequest {
  readonly url: string;
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface WebhookResponse {
  readonly status: number;
}

export interface WebhookTransport {
  /** Resolves with the status for any HTTP answer; throws only when no answer arrived. */
  post(request: WebhookRequest): Promise<WebhookResponse>;
}
