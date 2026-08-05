import { describe, expect, test } from "bun:test";
import { ConfigurationError, isMayarinError, ProviderError } from "@mayarin/shared";
import { PythPriceOracle } from "../src/adapter.ts";
import { normalizeFeedId, scalePythPrice } from "../src/hermes.ts";

const ETH_USD_FEED = "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";

function hermesBody(
  overrides: Partial<{ id: string; price: string; expo: number; publish_time: number }> = {},
) {
  return {
    parsed: [
      {
        id: overrides.id ?? ETH_USD_FEED,
        price: {
          price: overrides.price ?? "370000000000",
          conf: "150000000",
          expo: overrides.expo ?? -8,
          publish_time: overrides.publish_time ?? 1_785_915_000,
        },
      },
    ],
  };
}

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  const fn = (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
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

function oracle(
  fetchFn: typeof fetch,
  feeds: Record<string, string> = { "ETH/USDC": ETH_USD_FEED },
) {
  return new PythPriceOracle({ feeds, fetchFn });
}

describe("scalePythPrice", () => {
  test("negative net exponent divides half-up", () => {
    // expo -8 into 6-dp: shift -2. 123.45 -> 123, 123.55 -> 124.
    expect(scalePythPrice(12_345n, -8, 6)).toBe(123n);
    expect(scalePythPrice(12_355n, -8, 6)).toBe(124n);
  });

  test("zero net exponent is the significand itself", () => {
    expect(scalePythPrice(370n, -6, 6)).toBe(370n);
  });

  test("positive net exponent multiplies exactly", () => {
    expect(scalePythPrice(37n, -1, 6)).toBe(3_700_000n);
  });
});

describe("normalizeFeedId", () => {
  test("strips 0x and lowercases", () => {
    expect(normalizeFeedId(`0X${ETH_USD_FEED.toUpperCase()}`)).toBe(ETH_USD_FEED);
    expect(normalizeFeedId(ETH_USD_FEED)).toBe(ETH_USD_FEED);
  });
});

describe("PythPriceOracle", () => {
  test("serves a scaled reference with the publish time as observedAt", async () => {
    const { calls, fn } = stubFetch(() => json(hermesBody()));
    const price = await oracle(fn).reference("ETH", "USDC");

    // 3700 USD/ETH at expo -8 -> 3_700_000_000 minor USDC per whole ETH.
    expect(price.minorUnitsPerWholeUnit).toBe(3_700_000_000n);
    expect(price.source).toBe("pyth");
    expect(price.observedAt).toEqual(new Date(1_785_915_000 * 1_000));
    expect(calls[0]).toContain("/v2/updates/price/latest?ids[]=");
    expect(calls[0]).toContain(ETH_USD_FEED);
  });

  test("a configured 0x-prefixed feed id still matches the unprefixed response", async () => {
    const { fn } = stubFetch(() => json(hermesBody()));
    const withPrefix = oracle(fn, { "ETH/USDC": `0x${ETH_USD_FEED.toUpperCase()}` });

    const price = await withPrefix.reference("ETH", "USDC");
    expect(price.minorUnitsPerWholeUnit).toBe(3_700_000_000n);
  });

  test("an endpoint override is honoured", async () => {
    const { calls, fn } = stubFetch(() => json(hermesBody()));
    const custom = new PythPriceOracle({
      feeds: { "ETH/USDC": ETH_USD_FEED },
      endpoint: "https://hermes.example.test",
      fetchFn: fn,
    });

    await custom.reference("ETH", "USDC");
    expect(calls[0]).toStartWith("https://hermes.example.test/");
  });

  test("a pair with no configured feed throws ConfigurationError", async () => {
    const { fn } = stubFetch(() => json(hermesBody()));

    expect(oracle(fn).reference("USDC", "ETH")).rejects.toThrow(ConfigurationError);
  });

  test("an HTTP failure is a retryable ProviderError", async () => {
    const { fn } = stubFetch(() => json({}, 503));

    try {
      await oracle(fn).reference("ETH", "USDC");
      throw new Error("expected reference to throw");
    } catch (error) {
      if (!isMayarinError(error)) throw error;
      expect(error.code).toBe("PROVIDER_ERROR");
      expect(error.retryable).toBe(true);
    }
  });

  test("a network fault is wrapped, with the cause preserved", async () => {
    const boom = new Error("connection reset");
    const { fn } = stubFetch(() => {
      throw boom;
    });

    try {
      await oracle(fn).reference("ETH", "USDC");
      throw new Error("expected reference to throw");
    } catch (error) {
      if (!isMayarinError(error)) throw error;
      expect(error).toBeInstanceOf(ProviderError);
      expect(error.cause).toBe(boom);
    }
  });

  test("an unexpected response shape is a ProviderError, not a crash", async () => {
    const { fn } = stubFetch(() => json({ parsed: [{ id: ETH_USD_FEED }] }));

    expect(oracle(fn).reference("ETH", "USDC")).rejects.toThrow(ProviderError);
  });

  test("a response missing the requested feed is a ProviderError", async () => {
    const { fn } = stubFetch(() => json(hermesBody({ id: "deadbeef" })));

    expect(oracle(fn).reference("ETH", "USDC")).rejects.toThrow(ProviderError);
  });

  test("a non-positive price is a ProviderError", async () => {
    const { fn } = stubFetch(() => json(hermesBody({ price: "0" })));

    expect(oracle(fn).reference("ETH", "USDC")).rejects.toThrow(ProviderError);
  });

  test("a price that rounds to zero minor units is a ProviderError", async () => {
    // 1 × 10^-8 USD into 2-dp IDRX-style minor units: rounds to zero.
    const { fn } = stubFetch(() => json(hermesBody({ price: "1" })));
    const tiny = oracle(fn, { "ETH/IDRX": ETH_USD_FEED });

    expect(tiny.reference("ETH", "IDRX")).rejects.toThrow(ProviderError);
  });
});
