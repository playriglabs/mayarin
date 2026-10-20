import { describe, expect, test } from "bun:test";
import type { RouteRequest } from "@mayarin/execution";
import { ConfigurationError, isMayarinError, money, ProviderError } from "@mayarin/shared";
import { LifiRouteSource } from "../src/route.ts";

const PAYMENT_ROUTER = "0x8F90e9ad0120dd03352a2bC01BdF302447Fb2537";
const DIAMOND = "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE";
const NATIVE = "0x0000000000000000000000000000000000000000";
const BSC_USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const BSC_CAKE = "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82";

/** What the deployment holds on BNB Smart Chain: CAKE and USDC as tokens, BNB as the coin. */
const tokenAddress = (chain: string, asset: string): string | undefined => {
  if (chain !== "bsc") return undefined;
  if (asset === "BNB") return NATIVE;
  return { USDC: BSC_USDC, CAKE: BSC_CAKE }[asset];
};

const ONE_HUNDRED_USDC = 100n * 10n ** 18n;

function request(overrides: Partial<RouteRequest> = {}): RouteRequest {
  return {
    payerAsset: "CAKE",
    settlementAsset: "USDC",
    exactOut: money(ONE_HUNDRED_USDC, "USDC"),
    maxIn: money(50n * 10n ** 18n, "CAKE"),
    recipient: PAYMENT_ROUTER,
    chain: "bsc",
    ...overrides,
  };
}

function routeBody(
  overrides: { fromAmount?: string; toAmountMin?: string; approvalAddress?: string } = {},
) {
  return {
    transactionRequest: { to: DIAMOND, data: "0xdeadbeef" },
    estimate: {
      fromAmount: overrides.fromAmount ?? "45956495260096723080",
      toAmount: "100719369370946312455",
      toAmountMin: overrides.toAmountMin ?? "100215772524091580892",
      approvalAddress: overrides.approvalAddress ?? DIAMOND,
    },
  };
}

function stubFetch(handler: (url: string) => Response) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fn = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    calls.push({ url, headers });
    return handler(url);
  }) as typeof fetch;
  return { calls, fn };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function source(fetchFn: typeof fetch, extra: { apiKey?: string } = {}) {
  return new LifiRouteSource({ tokenAddress: tokenAddress as never, fetchFn, ...extra });
}

describe("LifiRouteSource", () => {
  test("asks LiFi for an exact-output same-chain route into the PaymentRouter", async () => {
    const { calls, fn } = stubFetch(() => json(routeBody()));
    const route = await source(fn, { apiKey: "secret" }).route(request());

    const url = new URL(calls[0]?.url ?? "");
    expect(url.pathname).toBe("/v1/quote/toAmount");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      fromChain: "56",
      toChain: "56",
      fromToken: BSC_CAKE,
      toToken: BSC_USDC,
      toAmount: ONE_HUNDRED_USDC.toString(),
      // The router holds the input and receives the output: both are the router.
      fromAddress: PAYMENT_ROUTER,
      toAddress: PAYMENT_ROUTER,
    });
    expect(calls[0]?.headers["x-lifi-api-key"]).toBe("secret");
    expect(route).toEqual({
      router: DIAMOND,
      callData: "0xdeadbeef",
      expectedIn: money(45_956_495_260_096_723_080n, "CAKE"),
      source: "lifi",
    });
  });

  test("a native payer is named by the zero address", async () => {
    const { calls, fn } = stubFetch(() => json(routeBody({ fromAmount: "138017661118501352" })));
    await source(fn).route(request({ payerAsset: "BNB", maxIn: money(10n ** 18n, "BNB") }));
    expect(new URL(calls[0]?.url ?? "").searchParams.get("fromToken")).toBe(NATIVE);
  });

  test("refuses a route that would spend past the payer's bound", async () => {
    const { fn } = stubFetch(() => json(routeBody({ fromAmount: (51n * 10n ** 18n).toString() })));
    await expect(source(fn).route(request())).rejects.toThrow(/above the .* bound/);
  });

  test("refuses a route whose guaranteed output is below the locked minOut", async () => {
    const { fn } = stubFetch(() =>
      json(routeBody({ toAmountMin: (ONE_HUNDRED_USDC - 1n).toString() })),
    );
    await expect(source(fn).route(request())).rejects.toThrow(/below the locked/);
  });

  test("refuses a route that wants its approval anywhere but the contract it calls", async () => {
    const { fn } = stubFetch(() =>
      json(routeBody({ approvalAddress: "0x1111111111111111111111111111111111111111" })),
    );
    await expect(source(fn).route(request())).rejects.toThrow(ConfigurationError);
  });

  test("a token the deployment has no address for is a ConfigurationError, so the caller falls back", async () => {
    const { calls, fn } = stubFetch(() => json(routeBody()));
    await expect(source(fn).route(request({ payerAsset: "LINK" }))).rejects.toThrow(
      ConfigurationError,
    );
    await expect(source(fn).route(request({ chain: "base" }))).rejects.toThrow(ConfigurationError);
    expect(calls).toHaveLength(0);
  });

  test("no route is a retryable provider error, not a configuration mistake", async () => {
    const { fn } = stubFetch(() => json({ message: "no routes" }, 404));
    try {
      await source(fn).route(request());
      throw new Error("expected the route to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderError);
      if (!isMayarinError(error)) throw error;
      expect(error.retryable).toBe(true);
    }
  });

  test("an unreadable answer is a provider error", async () => {
    const { fn } = stubFetch(() => json({ estimate: {} }));
    await expect(source(fn).route(request())).rejects.toThrow(/unreadable/);
  });
});
