/**
 * LiFi executable-route adapter.
 *
 * `adapter.ts` prices with `/v1/quote`. This reads **`/v1/quote/toAmount`**, LiFi's
 * exact-output form, which returns the transaction to submit. `toAmount` is the
 * merchant's locked `minOut`, so the route is priced backwards from what must arrive
 * and the payer's unspent input comes back to them in the asset they paid with.
 *
 * LiFi is an aggregator: it looks across the DEXes of a chain for the deepest route,
 * which is why it can serve tokens whose own pools are thin. The price of that is its
 * fee and the spread of the route it picks, both inside the quote; the deviation guard
 * is given a wider limit for this venue for that reason.
 *
 * Both `fromAddress` and `toAddress` are the **PaymentRouter**: it holds the input when
 * the swap runs and it receives the output, so LiFi must build the transaction for the
 * router as the account spending and receiving. The call goes to LiFi's diamond, which
 * the PaymentRouter must have whitelisted as a DEX router.
 *
 * Nothing here is trusted for safety. The calldata is LiFi's, and `PaymentRouter`
 * measures what arrived, refuses anything under `minOut` and refuses a resting balance,
 * so a route that misbehaves reverts instead of paying less.
 */

import { chainUnitScale, evmChainIdOf, toChainUnits } from "@mayarin/chain";
import type { ExecutableRoute, RouteRequest, SwapRouteSource } from "@mayarin/execution";
import { ConfigurationError, money, ProviderError } from "@mayarin/shared";
import { DEFAULT_LIFI_ENDPOINT, type LifiTokenResolver } from "./adapter.ts";
import { lifiRouteResponseSchema } from "./quote-api.ts";

export interface LifiRouteSourceOptions {
  /** Resolves a payer or settlement asset to its token on a chain (zero address for native). */
  readonly tokenAddress: LifiTokenResolver;
  /** Optional API key; LiFi serves unauthenticated requests at a lower rate limit. */
  readonly apiKey?: string;
  /** Names the integration to LiFi. */
  readonly integrator?: string;
  /**
   * The slippage LiFi may take on the route, as a fraction (0.005 is 0.5%). LiFi sizes the
   * input so that the output still clears the amount asked for after this much slippage.
   */
  readonly slippage?: number;
  readonly endpoint?: string;
  /** Injected for tests; defaults to the global `fetch`. */
  readonly fetchFn?: typeof fetch;
}

export class LifiRouteSource implements SwapRouteSource {
  readonly name = "lifi";
  readonly #tokenAddress: LifiTokenResolver;
  readonly #apiKey: string | undefined;
  readonly #integrator: string | undefined;
  readonly #slippage: number;
  readonly #endpoint: string;
  readonly #fetchFn: typeof fetch;

  constructor(options: LifiRouteSourceOptions) {
    this.#tokenAddress = options.tokenAddress;
    this.#apiKey = options.apiKey;
    this.#integrator = options.integrator;
    this.#slippage = options.slippage ?? 0.005;
    this.#endpoint = options.endpoint ?? DEFAULT_LIFI_ENDPOINT;
    this.#fetchFn = options.fetchFn ?? fetch;
  }

  async route(request: RouteRequest): Promise<ExecutableRoute> {
    const pair = `${request.payerAsset}/${request.settlementAsset}`;
    const fromToken = this.#tokenAddress(request.chain, request.payerAsset);
    const toToken = this.#tokenAddress(request.chain, request.settlementAsset);
    // A token the deployment holds no address for on this chain cannot be routed here;
    // refusing lets the caller fall back to the next route source.
    if (fromToken === undefined || toToken === undefined) {
      throw new ConfigurationError(`LiFi has no token address for ${pair} on ${request.chain}`, {
        pair,
        chain: request.chain,
      });
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

    // The request counts in the domain's units; LiFi and the chain count in the token's.
    const exactOutOnChain = toChainUnits(
      request.chain,
      request.settlementAsset,
      request.exactOut.amount,
    );
    const maxInOnChain = toChainUnits(request.chain, request.payerAsset, request.maxIn.amount);

    const chainId = String(evmChainIdOf(request.chain));
    const query = new URLSearchParams({
      fromChain: chainId,
      toChain: chainId,
      fromToken,
      toToken,
      toAmount: exactOutOnChain.toString(),
      fromAddress: request.recipient,
      toAddress: request.recipient,
      slippage: String(this.#slippage),
    });
    if (this.#integrator !== undefined) query.set("integrator", this.#integrator);

    const headers: Record<string, string> =
      this.#apiKey === undefined ? {} : { "x-lifi-api-key": this.#apiKey };
    let response: Response;
    try {
      response = await this.#fetchFn(`${this.#endpoint}/v1/quote/toAmount?${query}`, { headers });
    } catch (cause) {
      throw new ProviderError(
        `LiFi route request failed for ${pair}`,
        { pair, chain: request.chain },
        { cause },
      );
    }
    if (!response.ok) {
      // A missing route is a market condition and a retry may find one.
      throw new ProviderError(`LiFi has no route for ${pair} on ${request.chain}`, {
        pair,
        chain: request.chain,
        status: response.status,
      });
    }

    const parsed = lifiRouteResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new ProviderError(`LiFi returned an unreadable route for ${pair}`, {
        pair,
        issues: parsed.error.issues.map((issue) => issue.path.join(".")),
      });
    }
    const { transactionRequest, estimate } = parsed.data;

    // The PaymentRouter approves the input to the contract it calls and to nothing else, so
    // a route that wants its approval elsewhere cannot be run through it.
    if (
      estimate.approvalAddress !== undefined &&
      estimate.approvalAddress.toLowerCase() !== transactionRequest.to.toLowerCase()
    ) {
      throw new ConfigurationError(
        `LiFi wants ${pair} approved to ${estimate.approvalAddress}, not the contract it calls`,
        { pair, to: transactionRequest.to, approvalAddress: estimate.approvalAddress },
      );
    }

    const expectedIn = BigInt(estimate.fromAmount);
    if (expectedIn > maxInOnChain) {
      throw new ProviderError(
        `LiFi route would spend ${expectedIn} of ${request.payerAsset}, above the ${maxInOnChain} bound`,
        { pair, expectedIn: expectedIn.toString(), maxIn: maxInOnChain.toString() },
      );
    }
    // What LiFi guarantees after its own slippage must still clear `minOut`; a route that
    // might deliver less would revert on chain against it, and catching it here costs the
    // payer nothing instead of costing them gas.
    const guaranteed = BigInt(estimate.toAmountMin);
    if (guaranteed < exactOutOnChain) {
      throw new ProviderError(
        `LiFi guarantees ${guaranteed}, below the locked ${exactOutOnChain}`,
        { pair, toAmountMin: guaranteed.toString() },
      );
    }

    return {
      router: transactionRequest.to,
      callData: transactionRequest.data as `0x${string}`,
      // Back in the domain's units, rounded up: this is a spend, and it must not be understated.
      expectedIn: money(
        ceilDiv(expectedIn, chainUnitScale(request.chain, request.payerAsset)),
        request.payerAsset,
      ),
      source: this.name,
    };
  }
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}
