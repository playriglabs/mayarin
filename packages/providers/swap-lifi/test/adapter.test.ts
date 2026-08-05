import { describe, expect, test } from "bun:test";
import {
  ConfigurationError,
  isMayarinError,
  money,
  ProviderError,
  ValidationError,
} from "@mayarin/shared";
import { type LifiPair, LifiSwapVenue } from "../src/adapter.ts";
import { scaleSwapRate } from "../src/quote-api.ts";

const FROM_ADDRESS = "0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0";

const ETH_USDC: Record<string, LifiPair> = {
  "ETH/USDC": {
    chainId: 8453,
    fromToken: "0x0000000000000000000000000000000000000000",
    toToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
};

const ONE_ETH = money(10n ** 18n, "ETH");

function quoteBody(overrides: Partial<{ fromAmount: string; toAmount: string }> = {}) {
  return {
    estimate: {
      fromAmount: overrides.fromAmount ?? (10n ** 18n).toString(),
      toAmount: overrides.toAmount ?? "3700000000",
    },
  };
}

interface RecordedRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
}

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  const calls: RecordedRequest[] = [];
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function venue(fetchFn: typeof fetch, pairs: Record<string, LifiPair> = ETH_USDC) {
  return new LifiSwapVenue({ pairs, fromAddress: FROM_ADDRESS, fetchFn });
}

describe("scaleSwapRate", () => {
  test("a whole-unit sell is the amount out itself", () => {
    expect(scaleSwapRate(10n ** 18n, 3_700_000_000n, 18)).toBe(3_700_000_000n);
  });

  test("a partial sell scales up to the whole-unit rate", () => {
    expect(scaleSwapRate(5n * 10n ** 17n, 1_850_000_000n, 18)).toBe(3_700_000_000n);
  });

  test("the division floors, never overstating the rate", () => {
    // 10 minor units out for 3 minor units in, 0-decimal from: 10/3 -> 3.
    expect(scaleSwapRate(3n, 10n, 0)).toBe(3n);
  });
});

describe("LifiSwapVenue", () => {
  test("serves a scaled quote and names itself lifi", async () => {
    const { calls, fn } = stubFetch(() => json(quoteBody()));
    const quote = await venue(fn).quote("ETH", "USDC", ONE_ETH);

    expect(quote).toEqual({
      from: "ETH",
      to: "USDC",
      minorUnitsPerWholeUnit: 3_700_000_000n,
      source: "lifi",
    });
    expect(calls[0]?.url).toContain("/v1/quote?");
    expect(calls[0]?.url).toContain("fromChain=8453");
    expect(calls[0]?.url).toContain("toChain=8453");
    expect(calls[0]?.url).toContain("fromAmount=1000000000000000000");
    expect(calls[0]?.url).toContain(`fromAddress=${FROM_ADDRESS}`);
  });

  test("sends the API key header only when one is configured", async () => {
    const { calls, fn } = stubFetch(() => json(quoteBody()));
    await venue(fn).quote("ETH", "USDC", ONE_ETH);
    expect(calls[0]?.headers["x-lifi-api-key"]).toBeUndefined();

    const keyed = new LifiSwapVenue({
      pairs: ETH_USDC,
      fromAddress: FROM_ADDRESS,
      apiKey: "test-key",
      fetchFn: fn,
    });
    await keyed.quote("ETH", "USDC", ONE_ETH);
    expect(calls[1]?.headers["x-lifi-api-key"]).toBe("test-key");
  });

  test("an endpoint override is honoured", async () => {
    const { calls, fn } = stubFetch(() => json(quoteBody()));
    const custom = new LifiSwapVenue({
      pairs: ETH_USDC,
      fromAddress: FROM_ADDRESS,
      endpoint: "https://lifi.example.test",
      fetchFn: fn,
    });

    await custom.quote("ETH", "USDC", ONE_ETH);
    expect(calls[0]?.url).toStartWith("https://lifi.example.test/");
  });

  test("the rate follows the sell amount the venue actually priced", async () => {
    const { fn } = stubFetch(() =>
      json(quoteBody({ fromAmount: (5n * 10n ** 17n).toString(), toAmount: "1850000000" })),
    );
    const quote = await venue(fn).quote("ETH", "USDC", ONE_ETH);

    expect(quote.minorUnitsPerWholeUnit).toBe(3_700_000_000n);
  });

  test("a pair with no configured tokens throws ConfigurationError", async () => {
    const { calls, fn } = stubFetch(() => json(quoteBody()));

    expect(venue(fn).quote("USDC", "ETH", money(1_000_000n, "USDC"))).rejects.toThrow(
      ConfigurationError,
    );
    expect(calls).toHaveLength(0);
  });

  test("an amount in a different asset than the sell asset is refused", async () => {
    const { fn } = stubFetch(() => json(quoteBody()));

    expect(venue(fn).quote("ETH", "USDC", money(1_000_000n, "USDC"))).rejects.toThrow(
      ValidationError,
    );
  });

  test("a non-positive amount is refused", async () => {
    const { fn } = stubFetch(() => json(quoteBody()));

    expect(venue(fn).quote("ETH", "USDC", money(0n, "ETH"))).rejects.toThrow(ValidationError);
  });

  test("an HTTP failure is a retryable ProviderError with the status", async () => {
    const { fn } = stubFetch(() => json({ message: "no route found" }, 404));

    try {
      await venue(fn).quote("ETH", "USDC", ONE_ETH);
      throw new Error("expected quote to throw");
    } catch (error) {
      if (!isMayarinError(error)) throw error;
      expect(error.code).toBe("PROVIDER_ERROR");
      expect(error.retryable).toBe(true);
      expect(error.details.status).toBe(404);
    }
  });

  test("a network fault is wrapped, with the cause preserved", async () => {
    const boom = new Error("connection reset");
    const { fn } = stubFetch(() => {
      throw boom;
    });

    try {
      await venue(fn).quote("ETH", "USDC", ONE_ETH);
      throw new Error("expected quote to throw");
    } catch (error) {
      if (!isMayarinError(error)) throw error;
      expect(error).toBeInstanceOf(ProviderError);
      expect(error.cause).toBe(boom);
    }
  });

  test("a non-JSON body is a ProviderError, not a crash", async () => {
    const { fn } = stubFetch(() => new Response("<html>rate limited</html>", { status: 200 }));

    expect(venue(fn).quote("ETH", "USDC", ONE_ETH)).rejects.toThrow(ProviderError);
  });

  test("an unexpected response shape is a ProviderError, not a crash", async () => {
    const { fn } = stubFetch(() => json({ estimate: { toAmount: "3700000000" } }));

    expect(venue(fn).quote("ETH", "USDC", ONE_ETH)).rejects.toThrow(ProviderError);
  });

  test("a zero priced sell amount is a ProviderError", async () => {
    const { fn } = stubFetch(() => json(quoteBody({ fromAmount: "0" })));

    expect(venue(fn).quote("ETH", "USDC", ONE_ETH)).rejects.toThrow(ProviderError);
  });

  test("a quote that rounds to zero minor units is a ProviderError", async () => {
    const { fn } = stubFetch(() => json(quoteBody({ toAmount: "0" })));

    expect(venue(fn).quote("ETH", "USDC", ONE_ETH)).rejects.toThrow(ProviderError);
  });
});
