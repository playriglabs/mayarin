import { describe, expect, test } from "bun:test";
import { ConfigurationError, isMayarinError, ProviderError } from "@mayarin/shared";
import { type PythFeed, PythPriceOracle } from "../src/adapter.ts";
import {
  invertPythPrice,
  normalizeFeedId,
  quantisationBps,
  scalePythPrice,
} from "../src/hermes.ts";

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
  feeds: Record<string, PythFeed> = { "ETH/USDC": ETH_USD_FEED },
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

// ---------------------------------------------------------------------------
// Inverted feeds (#88)
//
// Pyth publishes FX.USD/IDR — rupiah per dollar — and nothing for the reverse,
// so an IDR-priced merchant can only be served by inverting it.
// ---------------------------------------------------------------------------

/** FX.USD/IDR at 16,000.00000 rupiah per dollar, the shape Hermes returns. */
const USD_IDR_FEED = "6693afcd49878bbd622e46bd805e7177932cf6ab0b1c91b135d71151b9207433";
const USD_IDR_PRICE = "1600000000";
const USD_IDR_EXPO = -5;

describe("invertPythPrice", () => {
  test("takes the reciprocal into minor units of the target", () => {
    // 1 IDR = 1/16000 USD = 0.0000625 USDC = 62.5 minor units, half-up to 63.
    expect(invertPythPrice(1_600_000_000n, -5, 6)).toBe(63n);
  });

  test("a larger reciprocal quantises far more finely", () => {
    // 1 USD = 1/1 ETH-ish: a rate in the thousands loses almost nothing.
    expect(invertPythPrice(10_000n, -4, 18)).toBe(10n ** 18n);
  });

  test("refuses a non-positive price rather than dividing by zero", () => {
    expect(() => invertPythPrice(0n, -5, 6)).toThrow();
    expect(() => invertPythPrice(-1n, -5, 6)).toThrow();
  });

  test("inverting twice returns to roughly the original rate", () => {
    const forward = scalePythPrice(1_600_000_000n, -5, 6); // IDR per USD, in USDC minor
    const back = invertPythPrice(1_600_000_000n, -5, 6);
    expect(forward).toBeGreaterThan(back);
  });
});

describe("the precision this representation loses", () => {
  test("IDR into a 6-decimal stablecoin quantises by more than the fee", () => {
    const rounded = invertPythPrice(1_600_000_000n, -5, 6);
    const bps = quantisationBps(62.5, rounded);

    // 80 bps, against a 50 bps fee. The loss is in `minorUnitsPerWholeUnit` —
    // one integer per whole source unit — not in the inversion; inverting is
    // only what makes it reachable. See the follow-up issue.
    expect(Math.round(bps)).toBe(80);
    expect(bps).toBeGreaterThan(50);
  });

  test("a high-value source asset loses essentially nothing", () => {
    const rounded = scalePythPrice(370_000_000_000n, -8, 6);
    expect(quantisationBps(3_700_000_000, rounded)).toBeLessThan(1);
  });
});

describe("PythPriceOracle with an inverted feed", () => {
  test("serves IDR -> USDC from the USD/IDR feed", async () => {
    const stub = stubFetch(() =>
      json(hermesBody({ id: USD_IDR_FEED, price: USD_IDR_PRICE, expo: USD_IDR_EXPO })),
    );
    const price = await oracle(stub.fn, {
      "IDR/USDC": { id: USD_IDR_FEED, invert: true },
    }).reference("IDR", "USDC");

    expect(price.minorUnitsPerWholeUnit).toBe(63n);
    expect(price.from).toBe("IDR");
    expect(price.to).toBe("USDC");
  });

  test("the same feed without the flag is read forward, not inverted", async () => {
    const stub = stubFetch(() =>
      json(hermesBody({ id: USD_IDR_FEED, price: USD_IDR_PRICE, expo: USD_IDR_EXPO })),
    );
    const price = await oracle(stub.fn, { "IDR/USDC": USD_IDR_FEED }).reference("IDR", "USDC");

    // 16,000 rupiah per dollar read as USDC per rupiah — off by the square of
    // the rate. Inversion is configuration, never inference, precisely because
    // this reads correctly and is catastrophically wrong.
    expect(price.minorUnitsPerWholeUnit).toBe(16_000_000_000n);
  });

  test("a bare string feed still works unchanged", async () => {
    const stub = stubFetch(() => json(hermesBody()));
    const price = await oracle(stub.fn).reference("ETH", "USDC");

    expect(price.minorUnitsPerWholeUnit).toBe(3_700_000_000n);
  });
});
