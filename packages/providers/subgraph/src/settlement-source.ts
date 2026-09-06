/**
 * `PaymentCompleted` logs, read from the subgraph instead of from the chain.
 *
 * The settlement indexer's own comment argues that a subgraph adds nothing over
 * `eth_getLogs` for one address and one event — and on Base that argument
 * holds. Arc is what breaks it: half-second blocks, and a provider tier that
 * refuses an `eth_getLogs` range wider than ten blocks. Ten blocks is five
 * seconds of chain per call, so no polling interval catches up, ever. A
 * subgraph has already done the scanning.
 *
 * What makes this safe to substitute is `indexedHead`. The indexer moves its
 * cursor across the range it asked about, so a source answering "no logs" for
 * blocks it has not reached would lose those settlements for good. Reporting
 * `_meta.block.number` lets the indexer stop exactly where this source's
 * knowledge stops.
 */

import type { ChainId, SettlementLog, SettlementQuery, SettlementSource } from "@mayarin/chain";
import { ConfigurationError, ProviderError } from "@mayarin/shared";
import { z } from "zod";
import { type FetchLike, postGraphql } from "./graphql.ts";

/**
 * Paged by block, not by offset.
 *
 * `skip` past a thousand is refused by graph-node, and a range wide enough to
 * need it is a range worth splitting anyway.
 */
const PAGE_SIZE = 1000;

const SETTLEMENTS_QUERY = `query Settlements($from: BigInt!, $to: BigInt!, $first: Int!, $skip: Int!) {
  settlements(
    first: $first
    skip: $skip
    orderBy: blockNumber
    orderDirection: asc
    where: { blockNumber_gte: $from, blockNumber_lte: $to }
  ) {
    intentId
    merchantSafe
    settledAmount
    fee
    refundAmount
    blockNumber
    blockHash
    logIndex
    transactionHash
  }
  _meta { block { number } hasIndexingErrors }
}`;

const META_QUERY = `{ _meta { block { number } hasIndexingErrors } }`;

const metaFields = z
  .object({
    block: z.object({ number: z.number() }),
    hasIndexingErrors: z.boolean(),
  })
  .nullable();

const settlementsSchema = z.object({
  settlements: z.array(
    z.object({
      intentId: z.string(),
      merchantSafe: z.string(),
      settledAmount: z.string(),
      fee: z.string(),
      refundAmount: z.string(),
      blockNumber: z.string(),
      blockHash: z.string(),
      logIndex: z.number(),
      transactionHash: z.string(),
    }),
  ),
  _meta: metaFields,
});

const metaSchema = z.object({ _meta: metaFields });

export interface SubgraphSettlementSourceOptions {
  /** One query URL per chain. A chain with no entry cannot be served. */
  readonly endpoints: Readonly<Partial<Record<ChainId, string>>>;
  /**
   * The router each endpoint indexes.
   *
   * A subgraph deployment is pinned to one address in its manifest, and nothing
   * in a query says which. Without this, pointing a chain at the wrong
   * deployment returns real settlements for the wrong router and reconciles
   * cleanly against nothing.
   */
  readonly routers: Readonly<Partial<Record<ChainId, string>>>;
  /** Studio or gateway API key, sent as a bearer token on every query. */
  readonly apiKey?: string;
  readonly fetch?: FetchLike;
}

export class SubgraphSettlementSource implements SettlementSource {
  readonly #endpoints: Readonly<Partial<Record<ChainId, string>>>;
  readonly #routers: Readonly<Partial<Record<ChainId, string>>>;
  readonly #fetch: FetchLike | undefined;
  readonly #apiKey: string | undefined;
  /**
   * The head a scan already paid for, waiting for the next `indexedHead`.
   *
   * Every pass asks for the head and then asks for the logs, which is two
   * billed queries where the second answer already carries the first: `_meta`
   * rides along in the settlements query. Consumed once rather than cached with
   * a lifetime, because a value that stayed would freeze the cursor — the
   * indexer would keep clamping to a height it has already scanned, never scan
   * again, and so never refresh the value it is clamping to.
   *
   * A consumed head is one pass old, which is only ever *lower* than the truth,
   * and the whole point of clamping is to stop early.
   */
  readonly #observedHead = new Map<ChainId, bigint>();

  constructor(options: SubgraphSettlementSourceOptions) {
    this.#endpoints = options.endpoints;
    this.#routers = options.routers;
    this.#fetch = options.fetch;
    this.#apiKey = options.apiKey;
  }

  async settlements(query: SettlementQuery): Promise<SettlementLog[]> {
    const endpoint = this.#endpointFor(query.chain);
    const expected = this.#routers[query.chain];
    if (expected === undefined || expected.toLowerCase() !== query.router.toLowerCase()) {
      throw new ConfigurationError(
        `subgraph for ${query.chain} indexes ${expected ?? "an unnamed router"}, not ${query.router}`,
        { chain: query.chain, router: query.router },
      );
    }

    const logs: SettlementLog[] = [];
    for (let skip = 0; ; skip += PAGE_SIZE) {
      const page = settlementsSchema.parse(
        await postGraphql(
          endpoint,
          SETTLEMENTS_QUERY,
          this.#fetch,
          {
            from: query.fromBlock.toString(),
            to: query.toBlock.toString(),
            first: PAGE_SIZE,
            skip,
          },
          this.#apiKey,
        ),
      );

      this.#observedHead.set(query.chain, this.#headOf(query.chain, endpoint, page._meta));

      for (const row of page.settlements) {
        logs.push({
          chain: query.chain,
          txHash: row.transactionHash,
          logIndex: row.logIndex,
          blockNumber: BigInt(row.blockNumber),
          blockHash: row.blockHash,
          intentId: row.intentId,
          merchantSafe: row.merchantSafe,
          settledAmount: BigInt(row.settledAmount),
          fee: BigInt(row.fee),
          refundAmount: BigInt(row.refundAmount),
        });
      }

      if (page.settlements.length < PAGE_SIZE) return logs;
    }
  }

  async indexedHead(chain: ChainId): Promise<bigint | undefined> {
    const observed = this.#observedHead.get(chain);
    if (observed !== undefined) {
      this.#observedHead.delete(chain);
      return observed;
    }

    const endpoint = this.#endpointFor(chain);
    const { _meta } = metaSchema.parse(
      await postGraphql(endpoint, META_QUERY, this.#fetch, undefined, this.#apiKey),
    );
    return this.#headOf(chain, endpoint, _meta);
  }

  #headOf(chain: ChainId, endpoint: string, meta: z.infer<typeof metaFields>): bigint {
    // No `_meta` means the deployment exists but has indexed nothing yet, which
    // is a head of zero rather than an unknown one.
    if (meta === null) return 0n;

    // An indexing error freezes the deployment where it broke. Serving that
    // height as if it were progress would let the cursor walk past blocks this
    // subgraph will never index.
    if (meta.hasIndexingErrors) {
      throw new ProviderError(`subgraph for ${chain} has indexing errors and cannot be trusted`, {
        chain,
        endpoint,
      });
    }

    return BigInt(meta.block.number);
  }

  #endpointFor(chain: ChainId): string {
    const endpoint = this.#endpoints[chain];
    if (endpoint === undefined) {
      throw new ConfigurationError(`no subgraph endpoint configured for ${chain}`, { chain });
    }
    return endpoint;
  }
}
