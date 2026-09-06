import { describe, expect, test } from "bun:test";
import {
  ConfigurationError,
  isMayarinError,
  ProviderError,
  RATE_SCALE,
  scaledRateFrom,
  unscaleRate,
} from "@mayarin/shared";
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
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(init === undefined ? { url } : { url, init });
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
  test("a fractional rate keeps its fraction instead of rounding to a whole unit", () => {
    // expo -8 into 6-dp is 123.45, which used to round to 123 and now survives.
    expect(scalePythPrice(12_345n, -8, 6)).toBe(123_450_000_000n);
    expect(scalePythPrice(12_355n, -8, 6)).toBe(123_550_000_000n);
  });

  test("zero net exponent is the significand, scaled", () => {
    expect(scalePythPrice(370n, -6, 6)).toBe(370n * RATE_SCALE);
  });

  test("positive net exponent multiplies exactly", () => {
    expect(scalePythPrice(37n, -1, 6)).toBe(3_700_000n * RATE_SCALE);
  });

  test("rounds half-up only past the last digit it can carry", () => {
    // 1/3 of a minor unit: nine digits, then half-up on the tenth.
    expect(scalePythPrice(1n, 0, 0) / 3n).toBe(333_333_333n);
    expect(scaledRateFrom(1n, 3n)).toBe(333_333_333n);
    expect(scaledRateFrom(2n, 3n)).toBe(666_666_667n);
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
    expect(price.scaledRate).toBe(3_700_000_000n * RATE_SCALE);
    expect(price.source).toBe("pyth");
    expect(price.observedAt).toEqual(new Date(1_785_915_000 * 1_000));
    expect(calls[0]?.url).toContain("/v2/updates/price/latest?ids[]=");
    expect(calls[0]?.url).toContain(ETH_USD_FEED);
  });

  test("a configured 0x-prefixed feed id still matches the unprefixed response", async () => {
    const { fn } = stubFetch(() => json(hermesBody()));
    const withPrefix = oracle(fn, { "ETH/USDC": `0x${ETH_USD_FEED.toUpperCase()}` });

    const price = await withPrefix.reference("ETH", "USDC");
    expect(price.scaledRate).toBe(3_700_000_000n * RATE_SCALE);
  });

  test("an endpoint override is honoured", async () => {
    const { calls, fn } = stubFetch(() => json(hermesBody()));
    const custom = new PythPriceOracle({
      feeds: { "ETH/USDC": ETH_USD_FEED },
      endpoint: "https://hermes.example.test",
      fetchFn: fn,
    });

    await custom.reference("ETH", "USDC");
    expect(calls[0]?.url).toStartWith("https://hermes.example.test/");
  });

  test("the default endpoint is the post-upgrade Pyth Hermes host", async () => {
    const { calls, fn } = stubFetch(() => json(hermesBody()));
    await oracle(fn).reference("ETH", "USDC");
    expect(calls[0]?.url).toStartWith("https://pyth.dourolabs.app/hermes/");
  });

  test("an API key is sent as a Bearer Authorization header", async () => {
    const { calls, fn } = stubFetch(() => json(hermesBody()));
    const withKey = new PythPriceOracle({
      feeds: { "ETH/USDC": ETH_USD_FEED },
      apiKey: "test-key",
      fetchFn: fn,
    });
    await withKey.reference("ETH", "USDC");
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers?.Authorization).toBe("Bearer test-key");
  });

  test("without an API key no Authorization header is sent", async () => {
    const { calls, fn } = stubFetch(() => json(hermesBody()));
    await oracle(fn).reference("ETH", "USDC");
    expect(calls[0]?.init?.headers).toBeUndefined();
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

  test("a 403 entitlement refusal is non-retryable so the engine fails fast", async () => {
    const { fn } = stubFetch(() => json({}, 403));

    try {
      await oracle(fn).reference("ETH", "USDC");
      throw new Error("expected reference to throw");
    } catch (error) {
      if (!isMayarinError(error)) throw error;
      expect(error.code).toBe("PROVIDER_ERROR");
      expect(error.retryable).toBe(false);
    }
  });

  test("a 401 auth refusal is non-retryable", async () => {
    const { fn } = stubFetch(() => json({}, 401));

    try {
      await oracle(fn).reference("ETH", "USDC");
      throw new Error("expected reference to throw");
    } catch (error) {
      if (!isMayarinError(error)) throw error;
      expect(error.code).toBe("PROVIDER_ERROR");
      expect(error.retryable).toBe(false);
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

  test("a price that rounds to zero even at full scale is a ProviderError", async () => {
    // The scale absorbs what used to round away, so this now needs a price far
    // smaller than before: 10^-30 into 6-dp minor units is still zero.
    const { fn } = stubFetch(() => json(hermesBody({ price: "1", expo: -30 })));
    const tiny = oracle(fn, { "ETH/USDT": ETH_USD_FEED });

    expect(tiny.reference("ETH", "USDT")).rejects.toThrow(ProviderError);
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
/** FX.USD/SGD at 1.28000000 Singapore dollars per US dollar. */
const USD_SGD_FEED = "396a969a9c1480fa15ed50bc59149e2c0075a72fe8f458ed941ddec48bdb4918";
const USD_SGD_PRICE = "128000000";
const USD_SGD_EXPO = -8;

describe("invertPythPrice", () => {
  test("takes the reciprocal into minor units of the target, exactly", () => {
    // 1 IDR = 1/16000 USD = 62.5 minor USDC. The half unit that used to be
    // rounded away — 80 bps of it — is now carried.
    expect(invertPythPrice(1_600_000_000n, -5, 6)).toBe(62_500_000_000n);
  });

  test("a larger reciprocal is unaffected", () => {
    expect(invertPythPrice(10_000n, -4, 18)).toBe(10n ** 18n * RATE_SCALE);
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

describe("the precision the scale recovers", () => {
  test("IDR into a 6-decimal stablecoin now quantises below a basis point", () => {
    // This was 80 bps — larger than the 50 bps fee — when a rate was one
    // integer per whole source unit. That is what RATE_DECIMALS fixed.
    const scaled = invertPythPrice(1_600_000_000n, -5, 6);

    expect(quantisationBps(62.5 * Number(RATE_SCALE), scaled)).toBeLessThan(1);
    expect(unscaleRate(scaled)).toBeCloseTo(62.5, 9);
  });

  test("a high-value source asset is unchanged", () => {
    const scaled = scalePythPrice(370_000_000_000n, -8, 6);
    expect(quantisationBps(3_700_000_000 * Number(RATE_SCALE), scaled)).toBeLessThan(1);
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

    expect(price.scaledRate).toBe(62_500_000_000n);
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
    expect(price.scaledRate).toBe(16_000_000_000n * RATE_SCALE);
  });

  test("serves SGD -> USDC from the USD/SGD feed", async () => {
    const stub = stubFetch(() =>
      json(hermesBody({ id: USD_SGD_FEED, price: USD_SGD_PRICE, expo: USD_SGD_EXPO })),
    );
    const pyth = oracle(stub.fn, {
      "SGD/USDC": { id: USD_SGD_FEED, invert: true },
    });

    const usdc = await pyth.reference("SGD", "USDC");

    expect(usdc.scaledRate).toBe(781_250n * RATE_SCALE);
    expect(usdc.to).toBe("USDC");
  });

  test("a bare string feed still works unchanged", async () => {
    const stub = stubFetch(() => json(hermesBody()));
    const price = await oracle(stub.fn).reference("ETH", "USDC");

    expect(price.scaledRate).toBe(3_700_000_000n * RATE_SCALE);
  });
});
