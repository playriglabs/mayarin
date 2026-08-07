import { describe, expect, test } from "bun:test";
import {
  ConfigurationError,
  isMayarinError,
  money,
  ProviderError,
  RATE_SCALE,
  ValidationError,
} from "@mayarin/shared";
import { type ZeroExPair, ZeroExSwapVenue } from "../src/adapter.ts";
import { scaleSwapRate } from "../src/swap-api.ts";

const ETH_USDC: Record<string, ZeroExPair> = {
  "ETH/USDC": {
    sellToken: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
    buyToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
};

const ONE_ETH = money(10n ** 18n, "ETH");

function priceBody(overrides: Partial<{ sellAmount: string; buyAmount: string }> = {}) {
  return {
    liquidityAvailable: true,
    sellAmount: overrides.sellAmount ?? (10n ** 18n).toString(),
    buyAmount: overrides.buyAmount ?? "3700000000",
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

function venue(fetchFn: typeof fetch, pairs: Record<string, ZeroExPair> = ETH_USDC) {
  return new ZeroExSwapVenue({ pairs, chainId: 8453, apiKey: "test-key", fetchFn });
}

describe("scaleSwapRate", () => {
  test("a whole-unit sell is the buy amount itself", () => {
    expect(scaleSwapRate(10n ** 18n, 3_700_000_000n, 18)).toBe(3_700_000_000n * RATE_SCALE);
  });

  test("a partial sell scales up to the whole-unit rate", () => {
    expect(scaleSwapRate(5n * 10n ** 17n, 1_850_000_000n, 18)).toBe(3_700_000_000n * RATE_SCALE);
  });

  test("the division floors, never overstating the rate", () => {
    // 10 minor units out for 3 minor units in, 0-decimal from: 10/3 -> 3.
    // 10/3 floors at RATE_DECIMALS: 3.333333333, never 3.333333334.
    expect(scaleSwapRate(3n, 10n, 0)).toBe(3_333_333_333n);
  });
});

describe("ZeroExSwapVenue", () => {
  test("serves a scaled quote and names itself 0x", async () => {
    const { calls, fn } = stubFetch(() => json(priceBody()));
    const quote = await venue(fn).quote("ETH", "USDC", ONE_ETH);

    expect(quote).toEqual({
      from: "ETH",
      to: "USDC",
      scaledRate: 3_700_000_000n * RATE_SCALE,
      source: "0x",
    });
    expect(calls[0]?.url).toContain("/swap/permit2/price?");
    expect(calls[0]?.url).toContain("chainId=8453");
    expect(calls[0]?.url).toContain("sellAmount=1000000000000000000");
    expect(calls[0]?.url).toContain(ETH_USDC["ETH/USDC"]?.buyToken ?? "");
  });

  test("sends the API key and the v2 version header", async () => {
    const { calls, fn } = stubFetch(() => json(priceBody()));
    await venue(fn).quote("ETH", "USDC", ONE_ETH);

    expect(calls[0]?.headers["0x-api-key"]).toBe("test-key");
    expect(calls[0]?.headers["0x-version"]).toBe("v2");
  });

  test("an endpoint override is honoured", async () => {
    const { calls, fn } = stubFetch(() => json(priceBody()));
    const custom = new ZeroExSwapVenue({
      pairs: ETH_USDC,
      chainId: 8453,
      apiKey: "test-key",
      endpoint: "https://api.example.test",
      fetchFn: fn,
    });

    await custom.quote("ETH", "USDC", ONE_ETH);
    expect(calls[0]?.url).toStartWith("https://api.example.test/");
  });

  test("the rate follows the sell amount the venue actually priced", async () => {
    // The venue priced half the requested size; the whole-unit rate still holds.
    const { fn } = stubFetch(() =>
      json(priceBody({ sellAmount: (5n * 10n ** 17n).toString(), buyAmount: "1850000000" })),
    );
    const quote = await venue(fn).quote("ETH", "USDC", ONE_ETH);

    expect(quote.scaledRate).toBe(3_700_000_000n * RATE_SCALE);
  });

  test("a pair with no configured tokens throws ConfigurationError", async () => {
    const { calls, fn } = stubFetch(() => json(priceBody()));

    expect(venue(fn).quote("USDC", "ETH", money(1_000_000n, "USDC"))).rejects.toThrow(
      ConfigurationError,
    );
    expect(calls).toHaveLength(0);
  });

  test("an amount in a different asset than the sell asset is refused", async () => {
    const { fn } = stubFetch(() => json(priceBody()));

    expect(venue(fn).quote("ETH", "USDC", money(1_000_000n, "USDC"))).rejects.toThrow(
      ValidationError,
    );
  });

  test("a non-positive amount is refused", async () => {
    const { fn } = stubFetch(() => json(priceBody()));

    expect(venue(fn).quote("ETH", "USDC", money(0n, "ETH"))).rejects.toThrow(ValidationError);
  });

  test("no liquidity is a retryable ProviderError", async () => {
    const { fn } = stubFetch(() => json({ liquidityAvailable: false }));

    try {
      await venue(fn).quote("ETH", "USDC", ONE_ETH);
      throw new Error("expected quote to throw");
    } catch (error) {
      if (!isMayarinError(error)) throw error;
      expect(error.code).toBe("PROVIDER_ERROR");
      expect(error.retryable).toBe(true);
    }
  });

  test("an HTTP failure is a retryable ProviderError with the status", async () => {
    const { fn } = stubFetch(() => json({}, 429));

    try {
      await venue(fn).quote("ETH", "USDC", ONE_ETH);
      throw new Error("expected quote to throw");
    } catch (error) {
      if (!isMayarinError(error)) throw error;
      expect(error.code).toBe("PROVIDER_ERROR");
      expect(error.retryable).toBe(true);
      expect(error.details.status).toBe(429);
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
    const { fn } = stubFetch(() => json({ liquidityAvailable: true, buyAmount: "3700000000" }));

    expect(venue(fn).quote("ETH", "USDC", ONE_ETH)).rejects.toThrow(ProviderError);
  });

  test("a zero priced sell amount is a ProviderError", async () => {
    const { fn } = stubFetch(() => json(priceBody({ sellAmount: "0" })));

    expect(venue(fn).quote("ETH", "USDC", ONE_ETH)).rejects.toThrow(ProviderError);
  });

  test("a price that rounds to zero minor units is a ProviderError", async () => {
    const { fn } = stubFetch(() => json(priceBody({ buyAmount: "0" })));

    expect(venue(fn).quote("ETH", "USDC", ONE_ETH)).rejects.toThrow(ProviderError);
  });
});
