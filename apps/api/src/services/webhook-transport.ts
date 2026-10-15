/**
 * Webhook transport that cannot be steered at the internal network (SEC-11).
 *
 * Registration validates a receiver's URL once; a name can resolve somewhere
 * else by the time a delivery runs (DNS rebinding), so every attempt is
 * checked again here: the hostname is resolved, every address must be public,
 * and the connection is pinned to the address that was checked. The pin is a
 * `lookup` on the socket, not a rewritten URL, so TLS still verifies the
 * certificate against the receiver's hostname.
 *
 * Redirects are not followed (`node:https` never does), a delivery signed for
 * one URL must not be replayed at another. The response body is never read:
 * the status is the whole answer, and a receiver streaming bytes back costs
 * nothing.
 */

import { promises as dns } from "node:dns";
import { request } from "node:https";
import {
  assertWebhookUrl,
  isPrivateAddress,
  type WebhookRequest,
  type WebhookResponse,
  type WebhookTransport,
} from "@mayarin/notifications";
import { ProviderError } from "@mayarin/shared";

export type AddressResolver = (hostname: string) => Promise<readonly string[]>;

const systemResolver: AddressResolver = async (hostname) =>
  (await dns.lookup(hostname, { all: true })).map((entry) => entry.address);

export interface PinnedWebhookTransportOptions {
  /** Whole-attempt deadline: connect, TLS, request and status line. */
  readonly timeoutMs?: number;
  readonly resolve?: AddressResolver;
}

export class PinnedWebhookTransport implements WebhookTransport {
  readonly #timeoutMs: number;
  readonly #resolve: AddressResolver;

  constructor(options: PinnedWebhookTransportOptions = {}) {
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    this.#resolve = options.resolve ?? systemResolver;
  }

  async post(webhook: WebhookRequest): Promise<WebhookResponse> {
    // The same policy registration applied: https, port 443, no credentials,
    // no literal private host.
    const url = assertWebhookUrl(webhook.url);
    const hostname = url.hostname.replace(/^\[|\]$/g, "");

    const addresses = await this.#resolve(hostname);
    const pinned = addresses[0];
    if (pinned === undefined || addresses.some(isPrivateAddress)) {
      throw new ProviderError(
        "Webhook host does not resolve to a public address",
        { hostname },
        { retryable: false },
      );
    }
    const family = pinned.includes(":") ? 6 : 4;

    return new Promise<WebhookResponse>((resolve, reject) => {
      const outgoing = request(
        {
          hostname,
          port: 443,
          path: `${url.pathname}${url.search}`,
          method: "POST",
          headers: webhook.headers,
          signal: AbortSignal.timeout(this.#timeoutMs),
          lookup: (_host, options, callback) => {
            if ((options as { all?: boolean }).all === true) {
              (callback as (error: null, addresses: unknown) => void)(null, [
                { address: pinned, family },
              ]);
            } else {
              callback(null, pinned, family);
            }
          },
        },
        (response) => {
          response.destroy();
          resolve({ status: response.statusCode ?? 0 });
        },
      );
      outgoing.on("error", reject);
      outgoing.end(webhook.body);
    });
  }
}
