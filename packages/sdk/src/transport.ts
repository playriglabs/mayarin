/**
 * The HTTP transport every SDK module calls through.
 *
 * Table stakes live here so no module re-implements them: the `/v1` path
 * prefix, the pinned `Mayarin-Version` header, bearer auth when a secret key is
 * present, an auto-generated `Idempotency-Key` on every write, and the mapping
 * of every failure onto `MayarinApiError`. Effects are injected — `fetch` and
 * the key generator come from config, so tests run without a server.
 *
 * `/v1` is the breaking axis: a `/v2` is a new URL a client opts into.
 * `Mayarin-Version` is the date rev within v1 (#138). Buyer pages
 * (`/checkout/:id`, `/invoices/:id/view`) live outside `/v1`, and the SDK never
 * fetches them — it hands their URLs to a browser.
 */

import { errorFromResponse, INVALID_RESPONSE, MayarinApiError, NETWORK_ERROR } from "./errors.ts";
import { MAYARIN_VERSION } from "./version.ts";

export interface TransportConfig {
  /** Origin of the payment API, e.g. `https://api.mayarin.xyz`. No trailing slash needed. */
  readonly baseUrl: string;
  /** Secret key for the merchant surface. Absent on the browser entry point. */
  readonly secretKey?: string;
  /** Publishable key (`pk_...`) for the public surface. Safe in a browser bundle (#113). */
  readonly publishableKey?: string;
  /** Injected for tests and non-global runtimes. Defaults to the global `fetch`. */
  readonly fetch?: typeof globalThis.fetch;
  /** Injected for tests. Defaults to `crypto.randomUUID`. */
  readonly generateIdempotencyKey?: () => string;
}

export type QueryParams = Readonly<Record<string, string | number | boolean | undefined>>;

export interface RequestOptions {
  readonly query?: QueryParams;
  /** Caller-supplied key for a write. The transport generates one when absent. */
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
}

export interface Transport {
  get<T>(path: string, options?: RequestOptions): Promise<T>;
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  patch<T>(path: string, body: unknown, options?: RequestOptions): Promise<T>;
  /** A write: gets an `Idempotency-Key` like every non-GET. A 204 resolves to `undefined`. */
  delete<T>(path: string, options?: RequestOptions): Promise<T>;
}

export function createTransport(config: TransportConfig): Transport {
  const fetchFn = config.fetch ?? globalThis.fetch;
  const generateKey = config.generateIdempotencyKey ?? (() => crypto.randomUUID());
  // Every module path is relative to the versioned API base (#138).
  const baseUrl = `${config.baseUrl.replace(/\/+$/, "")}/v1`;

  async function request<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body: unknown,
    options: RequestOptions,
  ): Promise<T> {
    const headers = new Headers({
      Accept: "application/json",
      "Mayarin-Version": MAYARIN_VERSION,
    });
    const bearerKey = config.secretKey ?? config.publishableKey;
    if (bearerKey !== undefined) {
      headers.set("Authorization", `Bearer ${bearerKey}`);
    }
    if (method !== "GET") {
      headers.set("Idempotency-Key", options.idempotencyKey ?? generateKey());
    }
    if (body !== undefined) {
      headers.set("Content-Type", "application/json");
    }

    let response: Response;
    try {
      response = await fetchFn(buildUrl(baseUrl, path, options.query), {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
    } catch (error) {
      throw new MayarinApiError(
        NETWORK_ERROR,
        "The request never reached the API",
        0,
        true,
        {},
        {
          cause: error,
        },
      );
    }

    const payload = await parseJson(response);
    if (!response.ok) {
      throw errorFromResponse(response.status, payload);
    }
    return payload as T;
  }

  return {
    get: (path, options = {}) => request("GET", path, undefined, options),
    post: (path, body, options = {}) => request("POST", path, body, options),
    patch: (path, body, options = {}) => request("PATCH", path, body, options),
    delete: (path, options = {}) => request("DELETE", path, undefined, options),
  };
}

function buildUrl(baseUrl: string, path: string, query: QueryParams | undefined): string {
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  if (query === undefined) return url;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded === "" ? url : `${url}?${encoded}`;
}

async function parseJson(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  try {
    return text === "" ? undefined : JSON.parse(text);
  } catch (error) {
    if (response.ok) {
      throw new MayarinApiError(
        INVALID_RESPONSE,
        "The API returned a body that is not JSON",
        response.status,
        false,
        {},
        { cause: error },
      );
    }
    // A non-JSON error body (a proxy's HTML 502, say) still maps to the one
    // error type; errorFromResponse falls back on the status alone.
    return undefined;
  }
}
