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

/** The `data` of a successful query, for the caller's own schema to parse. */
export async function postGraphql(
  endpoint: string,
  query: string,
  fetchImpl: FetchLike | undefined,
  variables?: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const send = fetchImpl ?? globalThis.fetch;

  let response: Response;
  try {
    response = await send(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
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
    throw new ProviderError(`subgraph at ${endpoint} answered ${response.status}`, {
      endpoint,
      status: response.status,
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
