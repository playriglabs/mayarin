/**
 * Rail observations, read from the settlements subgraph.
 *
 * One deployment per chain, so this holds one endpoint per chain and asks each
 * of them the same question: the most recent settlements, newest first, with
 * the headroom each landed with.
 *
 * It reads samples rather than an aggregate on purpose. The subgraph keeps a
 * `Rail` row with running totals, and a total is the one thing a median cannot
 * be recovered from — the tail is exactly what matters here, because a rail
 * whose worst settlements land seconds before the deadline is a rail about to
 * start failing.
 *
 * **It never reports a failure count.** A reverted payment leaves no log and an
 * authorization nobody broadcast leaves no transaction, so the subgraph cannot
 * know. Leaving `failures` undefined is what stops that unknown from being read
 * as a zero.
 */

import type { ChainId } from "@mayarin/chain";
import { ProviderError } from "@mayarin/shared";
import type { RailObservation, RailObservationSource } from "@mayarin/x402";
import { z } from "zod";

/** Newest first, so a shorter window is a smaller `first`. */
const OBSERVE_QUERY = `query Observe($first: Int!) {
  settlements(first: $first, orderBy: blockTimestamp, orderDirection: desc) {
    headroomSeconds
  }
}`;

/**
 * Numbers arrive as strings — GraphQL has no integer wide enough for a
 * `BigInt`, so the subgraph serialises every one of them as text.
 */
const responseSchema = z.object({
  data: z
    .object({
      settlements: z.array(z.object({ headroomSeconds: z.string() })),
    })
    .optional(),
  errors: z.array(z.object({ message: z.string() })).optional(),
});

/**
 * The one call this adapter makes.
 *
 * Narrower than `typeof fetch` on purpose: the global carries runtime-specific
 * extras (Bun adds `preconnect`), and requiring them would mean a test double
 * has to implement things the adapter never calls.
 */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface SubgraphRailObservationsOptions {
  /**
   * One query URL per chain. A chain with no entry is not observed at all —
   * that is a deployment saying it does not watch that rail, not a failure.
   */
  readonly endpoints: Readonly<Partial<Record<ChainId, string>>>;
  /** Settlements read per chain, newest first. */
  readonly sampleSize?: number;
  /** Injected so the port is testable without a network. */
  readonly fetch?: FetchLike;
}

const DEFAULT_SAMPLE_SIZE = 100;

export class SubgraphRailObservations implements RailObservationSource {
  readonly #endpoints: Readonly<Partial<Record<ChainId, string>>>;
  readonly #sampleSize: number;
  readonly #fetch: FetchLike;

  constructor(options: SubgraphRailObservationsOptions) {
    this.#endpoints = options.endpoints;
    this.#sampleSize = options.sampleSize ?? DEFAULT_SAMPLE_SIZE;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async observe(chains: readonly ChainId[]): Promise<readonly RailObservation[]> {
    const asked = chains.flatMap((chain) => {
      const endpoint = this.#endpoints[chain];
      return endpoint === undefined ? [] : [{ chain, endpoint }];
    });

    return await Promise.all(asked.map((one) => this.#observeOne(one.chain, one.endpoint)));
  }

  async #observeOne(chain: ChainId, endpoint: string): Promise<RailObservation> {
    const response = await this.#post(chain, endpoint);
    const body = responseSchema.parse(await response.json());

    // A GraphQL error arrives with HTTP 200 and no data. Treating that as an
    // empty rail would report "never settled" for a query that was rejected.
    const failure = body.errors?.[0];
    if (failure !== undefined || body.data === undefined) {
      throw new ProviderError(
        `subgraph for ${chain} answered with an error: ${failure?.message ?? "no data"}`,
        { chain, endpoint },
      );
    }

    return {
      chain,
      headroomSeconds: body.data.settlements.map((settlement) =>
        Number(settlement.headroomSeconds),
      ),
    };
  }

  async #post(chain: ChainId, endpoint: string): Promise<Response> {
    let response: Response;
    try {
      response = await this.#fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: OBSERVE_QUERY,
          variables: { first: this.#sampleSize },
        }),
      });
    } catch (error) {
      throw new ProviderError(
        `subgraph for ${chain} is unreachable`,
        { chain, endpoint },
        {
          cause: error,
        },
      );
    }

    if (!response.ok) {
      throw new ProviderError(`subgraph for ${chain} answered ${response.status}`, {
        chain,
        endpoint,
        status: response.status,
      });
    }
    return response;
  }
}
