import { describe, expect, test } from "bun:test";
import {
  ConfigurationError,
  FixedClock,
  isMayarinError,
  ProviderError,
  scaledRateFrom,
} from "@mayarin/shared";
import { CoinbasePriceOracle } from "../src/adapter.ts";

const OBSERVED_AT = new Date("2026-09-05T08:47:37.880Z");
const ETH_USDC: Record<string, string> = { "ETH/USDC": "ETH-USD" };

// The real ticker also carries the last trade (`price`, `time`), which is deliberately ignored: a
// product that has not traded for a minute still has a live book.
function tickerBody(overrides: Partial<{ bid: string; ask: string; time: string }> = {}) {
  return {
    ask: overrides.ask ?? "2455.33",
    bid: overrides.bid ?? "2455.31",
    volume: "84270.73304125",
    trade_id: 840_769_402,
    price: "2455.32",
    size: "0.610918",
    time: overrides.time ?? OBSERVED_AT.toISOString(),
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
  feeds: Record<string, string> = ETH_USDC,
  options: { clock?: FixedClock; cacheSeconds?: number } = {},
) {
  return new CoinbasePriceOracle({
    feeds,
    fetchFn,
    clock: options.clock ?? new FixedClock(OBSERVED_AT),
    ...(options.cacheSeconds === undefined ? {} : { cacheSeconds: options.cacheSeconds }),
  });
}

describe("CoinbasePriceOracle", () => {
  test("prices a product into the settlement asset's minor units", async () => {
    const { fn } = stubFetch(() => json(tickerBody()));
    const price = await oracle(fn).reference("ETH", "USDC");

    expect(price.from).toBe("ETH");
    expect(price.to).toBe("USDC");
    expect(price.source).toBe("coinbase");
    expect(price.observedAt).toEqual(OBSERVED_AT);
    expect(price.scaledRate).toBe(scaledRateFrom(2_455_320_000n, 1n));
  });

  test("reads the configured product, not a pair-derived guess", async () => {
    const { calls, fn } = stubFetch(() => json(tickerBody()));
    await oracle(fn).reference("ETH", "USDC");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.exchange.coinbase.com/products/ETH-USD/ticker");
  });

  // The public API rejects a request with no User-Agent, and nothing in a test
  // double would surface that: it has to be asserted or it is lost on a rename.
  test("identifies itself, which the public API requires", async () => {
    const { calls, fn } = stubFetch(() => json(tickerBody()));
    await oracle(fn).reference("ETH", "USDC");

    expect(calls[0]?.init?.headers).toEqual({ "User-Agent": "mayarin" });
  });

  // A near-peg pair is where a truncating adapter looks correct and is not:
  // 1.00003 must not read back as 1.
  test("carries the full precision of a near-peg pair", async () => {
    const { fn } = stubFetch(() => json(tickerBody({ bid: "1.00002", ask: "1.00004" })));
    const price = await oracle(fn, { "USDT/USDC": "USDT-USD" }).reference("USDT", "USDC");

    expect(price.scaledRate).toBe(scaledRateFrom(1_000_030n, 1n));
  });

  test("reuses an observation inside the cache window", async () => {
    const { calls, fn } = stubFetch(() => json(tickerBody()));
    const clock = new FixedClock(OBSERVED_AT);
    const source = oracle(fn, ETH_USDC, { clock, cacheSeconds: 10 });

    await source.reference("ETH", "USDC");
    clock.advance(9_000);
    await source.reference("ETH", "USDC");

    expect(calls).toHaveLength(1);
  });

  test("asks again once the cache window closes", async () => {
    const { calls, fn } = stubFetch(() => json(tickerBody()));
    const clock = new FixedClock(OBSERVED_AT);
    const source = oracle(fn, ETH_USDC, { clock, cacheSeconds: 10 });

    await source.reference("ETH", "USDC");
    clock.advance(10_000);
    await source.reference("ETH", "USDC");

    expect(calls).toHaveLength(2);
  });

  test("a product that has not traded for hours is current while its book is live", async () => {
    const stale = new Date(OBSERVED_AT.getTime() - 3 * 3_600_000).toISOString();
    const { fn } = stubFetch(() => json(tickerBody({ time: stale })));
    const price = await oracle(fn).reference("ETH", "USDC");

    expect(price.observedAt).toEqual(OBSERVED_AT);
  });

  test("a cached observation keeps the time it was read, so it still ages", async () => {
    const { fn } = stubFetch(() => json(tickerBody()));
    const clock = new FixedClock(OBSERVED_AT);
    const source = oracle(fn, ETH_USDC, { clock, cacheSeconds: 10 });

    await source.reference("ETH", "USDC");
    clock.advance(5_000);
    const price = await source.reference("ETH", "USDC");

    expect(price.observedAt).toEqual(OBSERVED_AT);
  });

  test("refuses a pair it has no product for", () => {
    const { fn } = stubFetch(() => json(tickerBody()));
    expect(oracle(fn).reference("BTC", "USDC")).rejects.toThrow(ConfigurationError);
  });

  // What a delisted product actually answers — EURC-USD returns exactly this.
  // Retrying it forever would hide a misconfiguration behind a stall.
  test("treats a delisted or unknown product as non-retryable", async () => {
    const { fn } = stubFetch(() => json({ message: "Not allowed for delisted products" }, 404));

    try {
      await oracle(fn).reference("ETH", "USDC");
      throw new Error("expected a ProviderError");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderError);
      expect(isMayarinError(error) && error.retryable).toBe(false);
    }
  });

  test("treats a rate limit as retryable", async () => {
    const { fn } = stubFetch(() => json({ message: "too many requests" }, 429));

    try {
      await oracle(fn).reference("ETH", "USDC");
      throw new Error("expected a ProviderError");
    } catch (error) {
      expect(isMayarinError(error) && error.retryable).toBe(true);
    }
  });

  test("treats a server fault as retryable", async () => {
    const { fn } = stubFetch(() => json({ message: "boom" }, 502));

    try {
      await oracle(fn).reference("ETH", "USDC");
      throw new Error("expected a ProviderError");
    } catch (error) {
      expect(isMayarinError(error) && error.retryable).toBe(true);
    }
  });

  test("rejects a price that is not a positive decimal", async () => {
    const { fn } = stubFetch(() => json(tickerBody({ bid: "-1.5" })));
    expect(oracle(fn).reference("ETH", "USDC")).rejects.toThrow(ProviderError);
  });

  test("rejects an empty side of the book", async () => {
    const { fn } = stubFetch(() => json(tickerBody({ bid: "0" })));
    expect(oracle(fn).reference("ETH", "USDC")).rejects.toThrow(ProviderError);
  });

  test("rejects a crossed book", async () => {
    const { fn } = stubFetch(() => json(tickerBody({ bid: "2455.40", ask: "2455.33" })));
    expect(oracle(fn).reference("ETH", "USDC")).rejects.toThrow(/crossed/i);
  });

  test("rejects a response that is not the expected shape", async () => {
    const { fn } = stubFetch(() => json({ price: "2455.32", time: OBSERVED_AT.toISOString() }));
    expect(oracle(fn).reference("ETH", "USDC")).rejects.toThrow(ProviderError);
  });

  test("rejects a response that is not JSON", async () => {
    const { fn } = stubFetch(() => new Response("<html>maintenance</html>", { status: 200 }));
    expect(oracle(fn).reference("ETH", "USDC")).rejects.toThrow(ProviderError);
  });

  test("wraps a transport failure", () => {
    const { fn } = stubFetch(() => {
      throw new Error("ECONNRESET");
    });
    expect(oracle(fn).reference("ETH", "USDC")).rejects.toThrow(ProviderError);
  });

  test("does not cache a failed read", async () => {
    let status = 502;
    const { calls, fn } = stubFetch(() =>
      status === 502 ? json({ message: "boom" }, 502) : json(tickerBody()),
    );
    const source = oracle(fn, ETH_USDC, { cacheSeconds: 600 });

    await expect(source.reference("ETH", "USDC")).rejects.toThrow(ProviderError);
    status = 200;
    await source.reference("ETH", "USDC");

    expect(calls).toHaveLength(2);
  });
});
