import { describe, expect, test } from "bun:test";
import {
  ConfigurationError,
  convert,
  FixedClock,
  isMayarinError,
  ProviderError,
  scaledRateFrom,
  unscaleRate,
} from "@mayarin/shared";
import { type FxFeed, FxRatesPriceOracle } from "../src/adapter.ts";

const OBSERVED_AT = new Date("2026-09-05T08:34:00.000Z");
const IDR_USDC: Record<string, FxFeed> = { "IDR/USDC": { symbol: "USD/IDR", invert: true } };

function fxBody(overrides: Partial<{ rates: Record<string, number>; timestamp: number }> = {}) {
  return {
    success: true,
    timestamp: overrides.timestamp ?? Math.floor(OBSERVED_AT.getTime() / 1_000),
    base: "USD",
    rates: overrides.rates ?? { IDR: 17635.003032099 },
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
  feeds: Record<string, FxFeed> = IDR_USDC,
  options: { apiKey?: string; clock?: FixedClock; cacheSeconds?: number } = {},
) {
  return new FxRatesPriceOracle({
    feeds,
    fetchFn,
    clock: options.clock ?? new FixedClock(OBSERVED_AT),
    ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
    ...(options.cacheSeconds === undefined ? {} : { cacheSeconds: options.cacheSeconds }),
  });
}

describe("FxRatesPriceOracle", () => {
  test("prices an inverted series into the target asset's minor units", async () => {
    const { fn } = stubFetch(() => json(fxBody()));
    const price = await oracle(fn).reference("IDR", "USDC");

    expect(price.from).toBe("IDR");
    expect(price.to).toBe("USDC");
    expect(price.source).toBe("fx");
    expect(price.observedAt).toEqual(OBSERVED_AT);
    expect(unscaleRate(price.scaledRate)).toBeCloseTo(56.7054, 4);
  });

  test("prices a series quoted in the pair's own direction", async () => {
    const { fn } = stubFetch(() => json(fxBody({ rates: { SGD: 1.2669 } })));
    const price = await oracle(fn, { "USD/SGD": "USD/SGD" }).reference("USD", "SGD");

    // SGD settles in 2-decimal minor units: 1.2669 dollars -> 126.69 cents.
    expect(price.scaledRate).toBe(scaledRateFrom(12_669n, 100n));
  });

  test("converts a zero-decimal yen price through to USDC settlement", async () => {
    const { fn } = stubFetch(() => json(fxBody({ rates: { JPY: 147.5 } })));
    const price = await oracle(fn, {
      "JPY/USDC": { symbol: "USD/JPY", invert: true },
    }).reference("JPY", "USDC");

    const settled = convert({ amount: 1_500n, asset: "JPY" }, "USDC", price.scaledRate);
    expect(settled.amount).toBeGreaterThan(10_169_000n);
    expect(settled.amount).toBeLessThan(10_170_000n);
  });

  test("asks the API for the series' own base and quote", async () => {
    const { calls, fn } = stubFetch(() => json(fxBody()));
    await oracle(fn).reference("IDR", "USDC");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.fxratesapi.com/latest?base=USD&currencies=IDR");
  });

  test("sends no Authorization header without a key", async () => {
    const { calls, fn } = stubFetch(() => json(fxBody()));
    await oracle(fn).reference("IDR", "USDC");

    expect(calls[0]?.init?.headers).toBeUndefined();
  });

  test("sends the key as a bearer token when configured", async () => {
    const { calls, fn } = stubFetch(() => json(fxBody()));
    await oracle(fn, IDR_USDC, { apiKey: "fx-key" }).reference("IDR", "USDC");

    expect(calls[0]?.init?.headers).toEqual({ Authorization: "Bearer fx-key" });
  });

  test("reuses an observation inside the cache window", async () => {
    const { calls, fn } = stubFetch(() => json(fxBody()));
    const clock = new FixedClock(OBSERVED_AT);
    const source = oracle(fn, IDR_USDC, { clock, cacheSeconds: 60 });

    await source.reference("IDR", "USDC");
    clock.advance(59_000);
    await source.reference("IDR", "USDC");

    expect(calls).toHaveLength(1);
  });

  test("asks again once the cache window closes", async () => {
    const { calls, fn } = stubFetch(() => json(fxBody()));
    const clock = new FixedClock(OBSERVED_AT);
    const source = oracle(fn, IDR_USDC, { clock, cacheSeconds: 60 });

    await source.reference("IDR", "USDC");
    clock.advance(60_000);
    await source.reference("IDR", "USDC");

    expect(calls).toHaveLength(2);
  });

  test("a cached observation keeps the provider's own timestamp, so it still ages", async () => {
    const { fn } = stubFetch(() => json(fxBody()));
    const clock = new FixedClock(OBSERVED_AT);
    const source = oracle(fn, IDR_USDC, { clock, cacheSeconds: 60 });

    await source.reference("IDR", "USDC");
    clock.advance(30_000);
    const price = await source.reference("IDR", "USDC");

    expect(price.observedAt).toEqual(OBSERVED_AT);
  });

  test("refuses a pair it has no series for", async () => {
    const { fn } = stubFetch(() => json(fxBody()));
    expect(oracle(fn).reference("ETH", "USDC")).rejects.toThrow(ConfigurationError);
  });

  test("refuses a series that is not BASE/QUOTE", async () => {
    const { fn } = stubFetch(() => json(fxBody()));
    expect(oracle(fn, { "IDR/USDC": "USDIDR" }).reference("IDR", "USDC")).rejects.toThrow(
      ConfigurationError,
    );
  });

  test("treats an auth or entitlement failure as non-retryable", async () => {
    const { fn } = stubFetch(() => json({ error: "unauthorized" }, 401));

    try {
      await oracle(fn).reference("IDR", "USDC");
      throw new Error("expected a ProviderError");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderError);
      expect(isMayarinError(error) && error.retryable).toBe(false);
    }
  });

  test("treats a rate limit as retryable", async () => {
    const { fn } = stubFetch(() => json({ error: "slow down" }, 429));

    try {
      await oracle(fn).reference("IDR", "USDC");
      throw new Error("expected a ProviderError");
    } catch (error) {
      expect(isMayarinError(error) && error.retryable).toBe(true);
    }
  });

  test("treats a server fault as retryable", async () => {
    const { fn } = stubFetch(() => json({ error: "boom" }, 503));

    try {
      await oracle(fn).reference("IDR", "USDC");
      throw new Error("expected a ProviderError");
    } catch (error) {
      expect(isMayarinError(error) && error.retryable).toBe(true);
    }
  });

  test("rejects a response missing the requested currency", async () => {
    const { fn } = stubFetch(() => json(fxBody({ rates: { SGD: 1.2669 } })));
    expect(oracle(fn).reference("IDR", "USDC")).rejects.toThrow(ProviderError);
  });

  test("rejects a non-positive rate", async () => {
    const { fn } = stubFetch(() => json(fxBody({ rates: { IDR: 0 } })));
    expect(oracle(fn).reference("IDR", "USDC")).rejects.toThrow(ProviderError);
  });

  test("rejects a response that is not the expected shape", async () => {
    const { fn } = stubFetch(() => json({ success: true, base: "USD" }));
    expect(oracle(fn).reference("IDR", "USDC")).rejects.toThrow(ProviderError);
  });

  test("rejects a response that is not JSON", async () => {
    const { fn } = stubFetch(() => new Response("<html>down</html>", { status: 200 }));
    expect(oracle(fn).reference("IDR", "USDC")).rejects.toThrow(ProviderError);
  });

  test("wraps a transport failure", async () => {
    const { fn } = stubFetch(() => {
      throw new Error("ECONNRESET");
    });
    expect(oracle(fn).reference("IDR", "USDC")).rejects.toThrow(ProviderError);
  });

  test("does not cache a failed read", async () => {
    let status = 503;
    const { calls, fn } = stubFetch(() =>
      status === 503 ? json({ error: "boom" }, 503) : json(fxBody()),
    );
    const source = oracle(fn, IDR_USDC, { cacheSeconds: 600 });

    await expect(source.reference("IDR", "USDC")).rejects.toThrow(ProviderError);
    status = 200;
    await source.reference("IDR", "USDC");

    expect(calls).toHaveLength(2);
  });
});

describe("FxRatesPriceOracle batching", () => {
  const MANY: Record<string, FxFeed> = {
    "IDR/USDC": { symbol: "USD/IDR", invert: true },
    "SGD/USDC": { symbol: "USD/SGD", invert: true },
    "THB/USDC": { symbol: "USD/THB", invert: true },
    "SGD/EURC": { symbol: "EUR/SGD", invert: true },
  };

  const RATES = { IDR: 17635.003032099, SGD: 1.2841, THB: 32.15 };

  test("prices the configured Middle East and Latin America series", async () => {
    const feeds: Record<string, FxFeed> = {
      "AED/USDC": { symbol: "USD/AED", invert: true },
      "SAR/USDC": { symbol: "USD/SAR", invert: true },
      "BRL/USDC": { symbol: "USD/BRL", invert: true },
      "MXN/USDC": { symbol: "USD/MXN", invert: true },
    };
    const rates = { AED: 3.6729, SAR: 3.75, BRL: 5.41, MXN: 18.62 };
    const { calls, fn } = stubFetch(() => json(fxBody({ rates })));
    const fx = oracle(fn, feeds);

    const aed = await fx.reference("AED", "USDC");
    const sar = await fx.reference("SAR", "USDC");
    const brl = await fx.reference("BRL", "USDC");
    const mxn = await fx.reference("MXN", "USDC");

    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]?.url ?? "").searchParams.get("currencies")?.split(",").sort()).toEqual([
      "AED",
      "BRL",
      "MXN",
      "SAR",
    ]);
    expect([aed, sar, brl, mxn].every(({ scaledRate }) => scaledRate > 0n)).toBe(true);
  });

  test("asks for every currency configured against the base, in one request", async () => {
    const { calls, fn } = stubFetch(() => json(fxBody({ rates: RATES })));

    await oracle(fn, MANY).reference("IDR", "USDC");

    expect(calls).toHaveLength(1);
    const asked = new URL(calls[0]?.url ?? "").searchParams;
    expect(asked.get("base")).toBe("USD");
    expect(asked.get("currencies")?.split(",").sort()).toEqual(["IDR", "SGD", "THB"]);
  });

  // The point of the batch: the free tier allows 61 requests per window, and
  // one request per pair on a hot path exhausted it — which surfaced as
  // "No fresh oracle price", indistinguishable from a dead feed.
  test("a second pair on the same base is served from the same response", async () => {
    const { calls, fn } = stubFetch(() => json(fxBody({ rates: RATES })));
    const fx = oracle(fn, MANY);

    await fx.reference("IDR", "USDC");
    const sgd = await fx.reference("SGD", "USDC");

    expect(calls).toHaveLength(1);
    // Served from the batch, not invented: 1 / 1.2841 into 6-decimal USDC.
    expect(sgd.scaledRate).toBeGreaterThan(0n);
    expect(sgd.observedAt).toEqual(OBSERVED_AT);
  });

  test("a different base is its own request", async () => {
    const { calls, fn } = stubFetch((url) =>
      json(
        url.includes("base=EUR")
          ? { ...fxBody({ rates: { SGD: 1.4972 } }), base: "EUR" }
          : fxBody({ rates: RATES }),
      ),
    );
    const fx = oracle(fn, MANY);

    await fx.reference("SGD", "USDC");
    await fx.reference("SGD", "EURC");

    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toContain("base=EUR");
  });

  test("a malformed symbol does not poison the batch for its base", async () => {
    const { calls, fn } = stubFetch(() => json(fxBody({ rates: RATES })));
    const fx = oracle(fn, { ...MANY, "MYR/USDC": { symbol: "nonsense", invert: true } });

    await fx.reference("IDR", "USDC");

    expect(calls).toHaveLength(1);
    // The bad pair still reports itself when asked for, naming the pair.
    expect(fx.reference("MYR", "USDC")).rejects.toThrow(ConfigurationError);
  });
});

describe("FxRatesPriceOracle rate limiting", () => {
  function tooMany(retryAfter?: string): Response {
    return new Response(JSON.stringify({ error: { code: "PE-R001" } }), {
      status: 429,
      headers: retryAfter === undefined ? {} : { "retry-after": retryAfter },
    });
  }

  // Measured against the live API: this provider counts a blocked request
  // against the window, so a retry pushes the deadline out instead of waiting
  // it out. The adapter refuses locally until the deadline it was given.
  test("a retry inside the window never reaches the API", async () => {
    const clock = new FixedClock(OBSERVED_AT);
    const deadline = OBSERVED_AT.getTime() + 120_000;
    const { calls, fn } = stubFetch(() => tooMany(String(deadline)));
    const fx = oracle(fn, IDR_USDC, { clock });

    expect(fx.reference("IDR", "USDC")).rejects.toThrow(ProviderError);
    await fx.reference("IDR", "USDC").catch(() => undefined);
    await fx.reference("IDR", "USDC").catch(() => undefined);

    expect(calls).toHaveLength(1);
  });

  test("the refusal says how long is left and stays retryable", async () => {
    const clock = new FixedClock(OBSERVED_AT);
    const { fn } = stubFetch(() => tooMany(String(OBSERVED_AT.getTime() + 90_000)));
    const fx = oracle(fn, IDR_USDC, { clock });

    await fx.reference("IDR", "USDC").catch(() => undefined);

    const error = await fx.reference("IDR", "USDC").catch((e: unknown) => e);
    expect(isMayarinError(error) && error.retryable).toBe(true);
    expect((error as Error).message).toContain("90s");
  });

  test("past the deadline the API is asked again", async () => {
    const clock = new FixedClock(OBSERVED_AT);
    let limited = true;
    const { calls, fn } = stubFetch(() =>
      limited ? tooMany(String(OBSERVED_AT.getTime() + 60_000)) : json(fxBody()),
    );
    const fx = oracle(fn, IDR_USDC, { clock });

    await fx.reference("IDR", "USDC").catch(() => undefined);
    limited = false;
    clock.set(new Date(OBSERVED_AT.getTime() + 61_000));
    const price = await fx.reference("IDR", "USDC");

    expect(calls).toHaveLength(2);
    expect(price.source).toBe("fx");
  });

  test("a delta-seconds retry-after is read as seconds, not an instant", async () => {
    const clock = new FixedClock(OBSERVED_AT);
    const { calls, fn } = stubFetch(() => tooMany("30"));
    const fx = oracle(fn, IDR_USDC, { clock });

    await fx.reference("IDR", "USDC").catch(() => undefined);
    clock.set(new Date(OBSERVED_AT.getTime() + 29_000));
    await fx.reference("IDR", "USDC").catch(() => undefined);
    expect(calls).toHaveLength(1);

    clock.set(new Date(OBSERVED_AT.getTime() + 31_000));
    await fx.reference("IDR", "USDC").catch(() => undefined);
    expect(calls).toHaveLength(2);
  });
});
