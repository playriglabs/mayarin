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
import type { RailObservation, RailObservationSource } from "@mayarin/x402";
import { z } from "zod";
import { type FetchLike, postGraphql } from "./graphql.ts";

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
const settlementsSchema = z.object({
  settlements: z.array(z.object({ headroomSeconds: z.string() })),
});

export interface SubgraphRailObservationsOptions {
  /**
   * One query URL per chain. A chain with no entry is not observed at all —
   * that is a deployment saying it does not watch that rail, not a failure.
   */
  readonly endpoints: Readonly<Partial<Record<ChainId, string>>>;
  /** Settlements read per chain, newest first. */
  readonly sampleSize?: number;
  /** Studio or gateway API key, sent as a bearer token on every query. */
  readonly apiKey?: string;
  /** Injected so the port is testable without a network. */
  readonly fetch?: FetchLike;
}

const DEFAULT_SAMPLE_SIZE = 100;

export class SubgraphRailObservations implements RailObservationSource {
  readonly #endpoints: Readonly<Partial<Record<ChainId, string>>>;
  readonly #sampleSize: number;
  readonly #fetch: FetchLike | undefined;
  readonly #apiKey: string | undefined;

  constructor(options: SubgraphRailObservationsOptions) {
    this.#endpoints = options.endpoints;
    this.#sampleSize = options.sampleSize ?? DEFAULT_SAMPLE_SIZE;
    this.#fetch = options.fetch;
    this.#apiKey = options.apiKey;
  }

  async observe(chains: readonly ChainId[]): Promise<readonly RailObservation[]> {
    const asked = chains.flatMap((chain) => {
      const endpoint = this.#endpoints[chain];
      return endpoint === undefined ? [] : [{ chain, endpoint }];
    });

    return await Promise.all(asked.map((one) => this.#observeOne(one.chain, one.endpoint)));
  }

  async #observeOne(chain: ChainId, endpoint: string): Promise<RailObservation> {
    const data = settlementsSchema.parse(
      await postGraphql(
        endpoint,
        OBSERVE_QUERY,
        this.#fetch,
        { first: this.#sampleSize },
        this.#apiKey,
      ),
    );

    return {
      chain,
      headroomSeconds: data.settlements.map((settlement) => Number(settlement.headroomSeconds)),
    };
  }
}
