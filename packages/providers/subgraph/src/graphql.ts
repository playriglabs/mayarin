/**
 * One POST, and the three ways it can lie.
 *
 * A GraphQL endpoint answers a rejected query with HTTP 200 and an `errors`
 * array, so "did it work" is not a status code. Every caller here needs the same
 * three checks — unreachable, non-200, `errors` — and a caller that skipped the
 * third would read a rejected query as an empty result.
 */

import { ProviderError } from "@mayarin/shared";
import { z } from "zod";

/**
 * The one call this package makes.
 *
 * Narrower than `typeof fetch` on purpose: the global carries runtime-specific
 * extras (Bun adds `preconnect`), and requiring them would mean a test double
 * has to implement things the adapter never calls.
 */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const envelopeSchema = z.object({
  data: z.unknown().optional(),
  errors: z.array(z.object({ message: z.string() })).optional(),
});

/**
 * The `data` of a successful query, for the caller's own schema to parse.
 *
 * `apiKey` is sent as a bearer token, which is how both Graph endpoints
 * authenticate: a Studio development URL and a gateway production URL take the
 * same header. It never reaches an error's `details` — an endpoint is worth
 * naming in a log, a credential is not.
 */
export async function postGraphql(
  endpoint: string,
  query: string,
  fetchImpl: FetchLike | undefined,
  variables?: Readonly<Record<string, unknown>>,
  apiKey?: string,
): Promise<unknown> {
  const send = fetchImpl ?? globalThis.fetch;

  let response: Response;
  try {
    response = await send(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` }),
      },
      body: JSON.stringify(variables === undefined ? { query } : { query, variables }),
    });
  } catch (error) {
    throw new ProviderError(
      `subgraph at ${endpoint} is unreachable`,
      { endpoint },
      { cause: error },
    );
  }

  if (!response.ok) {
    // A rate limiter says when to come back, and a caller that ignores it keeps
    // its own ban alive: every early retry is another counted request. The hint
    // travels in `details` because the loop that schedules the next pass is the
    // only thing that can act on it.
    const retryAfterMs = response.status === 429 ? retryAfterOf(response) : undefined;
    throw new ProviderError(`subgraph at ${endpoint} answered ${response.status}`, {
      endpoint,
      status: response.status,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    });
  }

  const body = envelopeSchema.parse(await response.json());
  const failure = body.errors?.[0];
  if (failure !== undefined || body.data === undefined) {
    throw new ProviderError(
      `subgraph at ${endpoint} answered with an error: ${failure?.message ?? "no data"}`,
      { endpoint },
    );
  }
  return body.data;
}

/**
 * `Retry-After`, in milliseconds, in either of the two forms RFC 9110 allows:
 * a delay in seconds, or an HTTP date.
 */
function retryAfterOf(response: Response): number | undefined {
  const header = response.headers.get("retry-after")?.trim();
  if (header === undefined || header === "") return undefined;

  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds <= 0 ? 0 : Math.round(seconds * 1000);

  const at = Date.parse(header);
  if (Number.isNaN(at)) return undefined;
  const delay = at - Date.now();
  return delay <= 0 ? 0 : delay;
}
