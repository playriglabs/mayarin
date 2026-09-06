/**
 * 0x executable-route adapter (RFC #5 — #57).
 *
 * `adapter.ts` reads `/swap/permit2/price` for planning. This reads
 * **`/swap/allowance-holder/quote`**, the firm endpoint that returns the
 * transaction to submit. Two different calls on purpose: the quote endpoint
 * commits liquidity and is rate-limited harder, so it runs once per payment
 * rather than once per price refresh.
 *
 * **Exact-output.** 0x takes either `sellAmount` or `buyAmount`; passing
 * `buyAmount` asks it to price backwards from the settlement amount the merchant
 * locked, so the route delivers exactly `minOut` and the payer's unspent input
 * comes back to them in the asset they paid with.
 *
 * `taker` is the **PaymentRouter**, not the payer. The router holds the input
 * when the swap runs — it pulled the payer's tokens through Permit2, or it holds
 * the native value — so 0x must build the transaction for the router as the
 * account spending and receiving.
 */

import { EVM_CHAIN_IDS } from "@mayarin/chain";
import { rateKey } from "@mayarin/clearing";
import type { ExecutableRoute, RouteRequest, SwapRouteSource } from "@mayarin/execution";
import { ConfigurationError, money, ProviderError } from "@mayarin/shared";
import { z } from "zod";
import { DEFAULT_ZEROEX_ENDPOINT, type ZeroExPair } from "./adapter.ts";

const decimalString = z.string().regex(/^\d+$/);

/**
 * The slice of the quote response this adapter reads. 0x answers
 * `liquidityAvailable: false` with no transaction when it has no route, so the
 * schema models both arms and the adapter branches on the tag rather than on
 * missing fields.
 */
export const zeroExQuoteResponseSchema = z.discriminatedUnion("liquidityAvailable", [
  z.object({ liquidityAvailable: z.literal(false) }),
  z.object({
    liquidityAvailable: z.literal(true),
    sellAmount: decimalString,
    buyAmount: decimalString,
    transaction: z.object({
      to: z.string(),
      data: z.string(),
    }),
  }),
]);

export interface ZeroExRouteSourceOptions {
  /** Pair (`rateKey(from, to)`) to token addresses — the same map the venue uses. */
  readonly pairs: Readonly<Record<string, ZeroExPair>>;
  readonly chainId: number;
  readonly apiKey: string;
  readonly endpoint?: string;
  /** Injected for tests; defaults to the global `fetch`. */
  readonly fetchFn?: typeof fetch;
}

export class ZeroExRouteSource implements SwapRouteSource {
  readonly name = "0x";
  readonly #pairs: ReadonlyMap<string, ZeroExPair>;
  readonly #chainId: number;
  readonly #apiKey: string;
  readonly #endpoint: string;
  readonly #fetchFn: typeof fetch;

  constructor(options: ZeroExRouteSourceOptions) {
    this.#pairs = new Map(Object.entries(options.pairs));
    this.#chainId = options.chainId;
    this.#apiKey = options.apiKey;
    this.#endpoint = options.endpoint ?? DEFAULT_ZEROEX_ENDPOINT;
    this.#fetchFn = options.fetchFn ?? fetch;
  }

  async route(request: RouteRequest): Promise<ExecutableRoute> {
    const key = rateKey(request.payerAsset, request.settlementAsset);
    const pair = this.#pairs.get(key);
    if (pair === undefined) {
      throw new ConfigurationError(`0x has no configured pair for ${key}`, {
        pair: key,
        configured: [...this.#pairs.keys()],
      });
    }
    // 0x serves one configured chain. A route requested for another chain
    // cannot be filled there, so refuse and let the caller fall back.
    const requestChainId = EVM_CHAIN_IDS[request.chain];
    if (requestChainId !== BigInt(this.#chainId)) {
      throw new ConfigurationError(
        `0x is configured for chain id ${this.#chainId}, not ${request.chain} (${requestChainId})`,
        { pair: key, chain: request.chain, requestChainId, configuredChainId: this.#chainId },
      );
    }
    if (request.exactOut.asset !== request.settlementAsset) {
      throw new ConfigurationError("The exact output must be in the settlement asset", {
        exactOutAsset: request.exactOut.asset,
        settlementAsset: request.settlementAsset,
      });
    }
    if (request.maxIn.asset !== request.payerAsset) {
      throw new ConfigurationError("The input bound must be in the payer asset", {
        maxInAsset: request.maxIn.asset,
        payerAsset: request.payerAsset,
      });
    }

    const url = new URL("/swap/allowance-holder/quote", this.#endpoint);
    url.searchParams.set("chainId", String(this.#chainId));
    url.searchParams.set("sellToken", pair.sellToken);
    url.searchParams.set("buyToken", pair.buyToken);
    // Exact-output: price backwards from the merchant's locked settlement amount.
    url.searchParams.set("buyAmount", request.exactOut.amount.toString());
    url.searchParams.set("taker", request.recipient);

    let response: Response;
    try {
      response = await this.#fetchFn(url, { headers: this.#headers() });
    } catch (cause) {
      throw new ProviderError(`0x route request failed for ${key}`, {
        pair: key,
        cause: cause instanceof Error ? cause.message : String(cause),
      });
    }
    if (!response.ok) {
      throw new ProviderError(`0x rejected the route request for ${key}`, {
        pair: key,
        status: response.status,
      });
    }

    const parsed = zeroExQuoteResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new ProviderError(`0x returned an unreadable route for ${key}`, {
        pair: key,
        issues: parsed.error.issues.map((issue) => issue.path.join(".")),
      });
    }
    if (!parsed.data.liquidityAvailable) {
      // Retryable: liquidity is a market condition, not a caller mistake.
      throw new ProviderError(`0x has no liquidity to route ${key}`, { pair: key });
    }

    const expectedIn = BigInt(parsed.data.sellAmount);
    if (expectedIn > request.maxIn.amount) {
      throw new ProviderError(
        `0x route would spend ${expectedIn} of ${request.payerAsset}, above the ${request.maxIn.amount} bound`,
        { pair: key, expectedIn: expectedIn.toString(), maxIn: request.maxIn.amount.toString() },
      );
    }
    // A route delivering less than asked would revert on-chain against `minOut`;
    // catching it here costs the payer nothing instead of costing them gas.
    const buyAmount = BigInt(parsed.data.buyAmount);
    if (buyAmount < request.exactOut.amount) {
      throw new ProviderError(
        `0x route delivers ${buyAmount}, below the locked ${request.exactOut.amount}`,
        { pair: key, buyAmount: buyAmount.toString() },
      );
    }

    return {
      router: parsed.data.transaction.to,
      callData: parsed.data.transaction.data as `0x${string}`,
      expectedIn: money(expectedIn, request.payerAsset),
      source: this.name,
    };
  }

  #headers(): Record<string, string> {
    return { "0x-api-key": this.#apiKey, "0x-version": "v2" };
  }
}
