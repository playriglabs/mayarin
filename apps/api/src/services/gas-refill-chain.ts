/** The chain and LiFi sides of the gas refiller: RPC reads, and the stablecoin-to-native route. */

import { evmChainIdOf, isChainId } from "@mayarin/chain";
import { ConfigurationError, ProviderError } from "@mayarin/shared";
import { createPublicClient, http, type PublicClient, zeroAddress } from "viem";
import { z } from "zod";
import type { GasRefillChainPort, GasRefillerOptions } from "./gas-refiller.ts";

const LIFI_ENDPOINT = "https://li.quest";

/** Reads over each chain's RPC; writes go through `send`, the treasury executor's nonce lock. */
export function rpcGasRefillPort(options: {
  readonly rpcUrls: Readonly<Partial<Record<string, string>>>;
  readonly send: GasRefillChainPort["send"];
}): GasRefillChainPort {
  const clients = new Map<string, PublicClient>();
  const clientFor = (chain: string): PublicClient => {
    const rpcUrl = isChainId(chain) ? options.rpcUrls[chain] : undefined;
    if (rpcUrl === undefined)
      throw new ConfigurationError(`No RPC URL configured for ${chain}`, {});
    let client = clients.get(chain);
    if (client === undefined) {
      client = createPublicClient({ transport: http(rpcUrl) });
      clients.set(chain, client);
    }
    return client;
  };

  return {
    nativeBalance: (chain, holder) => clientFor(chain).getBalance({ address: holder }),
    async read(chain, to, data) {
      const { data: result } = await clientFor(chain).call({ to, data });
      return result ?? "0x";
    },
    send: options.send,
  };
}

const routeSchema = z.object({
  transactionRequest: z.object({
    to: z.string(),
    data: z.string(),
    value: z.string().optional(),
  }),
  estimate: z.object({
    toAmountMin: z.string().regex(/^\d+$/),
    approvalAddress: z.string().optional(),
  }),
});

/** LiFi's `/v1/quote`: sell exactly `amountIn` of a token for the chain's native currency. */
export function lifiGasRoute(options: {
  readonly apiKey?: string;
  readonly slippage?: number;
  readonly fetchFn?: typeof fetch;
}): GasRefillerOptions["route"] {
  const fetchFn = options.fetchFn ?? fetch;
  return async ({ chain, token, amountIn, taker }) => {
    const chainId = String(evmChainIdOf(chain));
    const query = new URLSearchParams({
      fromChain: chainId,
      toChain: chainId,
      fromToken: token,
      toToken: zeroAddress,
      fromAmount: amountIn.toString(),
      fromAddress: taker,
      toAddress: taker,
      slippage: String(options.slippage ?? 0.01),
    });
    const headers: Record<string, string> =
      options.apiKey === undefined ? {} : { "x-lifi-api-key": options.apiKey };
    const response = await fetchFn(`${LIFI_ENDPOINT}/v1/quote?${query}`, { headers });
    if (!response.ok) {
      throw new ProviderError(`LiFi has no gas refill route on ${chain}`, {
        chain,
        status: response.status,
      });
    }
    const parsed = routeSchema.parse(await response.json());
    const { transactionRequest, estimate } = parsed;
    return {
      to: transactionRequest.to,
      data: transactionRequest.data as `0x${string}`,
      value: BigInt(transactionRequest.value ?? "0x0"),
      approvalAddress: estimate.approvalAddress,
      toAmountMin: BigInt(estimate.toAmountMin),
    };
  };
}
