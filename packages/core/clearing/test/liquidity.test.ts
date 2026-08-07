import { describe, expect, test } from "bun:test";
import {
  type AssetCode,
  assetDecimals,
  ConfigurationError,
  money,
  RATE_SCALE,
} from "@mayarin/shared";
import {
  ConstantProductPriceSource,
  LiquidityRouter,
  type PriceQuote,
  type PriceSource,
  TablePriceSource,
} from "../src/liquidity.ts";

/** A stub source that records its arguments and returns a fixed quote. */
class StubSource implements PriceSource {
  readonly calls: Array<{ from: AssetCode; to: AssetCode; amount: bigint }> = [];

  async price(from: AssetCode, to: AssetCode, amount: { amount: bigint }): Promise<PriceQuote> {
    this.calls.push({ from, to, amount: amount.amount });
    return {
      from,
      to,
      scaledRate: 100n,
      source: "stub",
    };
  }
}

describe("PriceSource port", () => {
  test("price returns a PriceQuote shaped from/to/scaledRate/source", async () => {
    const source = new StubSource();
    const quote = await source.price("IDRX", "USDC", money(1_000n, "IDRX"));

    expect(quote.from).toBe("IDRX");
    expect(quote.to).toBe("USDC");
    // Whatever a source returns is already scaled; the port does not rescale.
    expect(quote.scaledRate).toBe(100n);
    expect(quote.source).toBe("stub");
    expect(quote.expiresAt).toBeUndefined();
  });

  test("price receives the amount being priced", async () => {
    const source = new StubSource();
    await source.price("IDRX", "USDC", money(5_000n, "IDRX"));
    expect(source.calls[0]?.amount).toBe(5_000n);
  });
});

describe("TablePriceSource", () => {
  const source = new TablePriceSource({ "IDRX/USDC": 100_0000n });

  test("returns the configured rate for a cross-asset pair", async () => {
    const quote = await source.price("IDRX", "USDC", money(10_000n, "IDRX"));
    expect(quote.scaledRate).toBe(100_0000n * RATE_SCALE);
    expect(quote.source).toBe("table");
    expect(quote.from).toBe("IDRX");
    expect(quote.to).toBe("USDC");
  });

  test("throws on a missing cross-asset pair", async () => {
    await expect(source.price("USDC", "IDRX", money(1_000_000n, "USDC"))).rejects.toBeInstanceOf(
      ConfigurationError,
    );
  });

  test("throws on a same-asset pair — identity is the router's job", async () => {
    await expect(source.price("IDRX", "IDRX", money(10_000n, "IDRX"))).rejects.toBeInstanceOf(
      ConfigurationError,
    );
  });

  test("carries a custom source label", async () => {
    const labelled = new TablePriceSource({ "IDRX/USDC": 100_0000n }, "exchange-rates");
    const quote = await labelled.price("IDRX", "USDC", money(10_000n, "IDRX"));
    expect(quote.source).toBe("exchange-rates");
  });
});

describe("ConstantProductPriceSource", () => {
  // Pool: 10,000.00 IDRX (1_000_000 minor) <-> 0.64 USDC (640_000 minor).
  // Marginal rate IDRX->USDC = 64 minor USDC per whole IDRX.
  const pools = {
    "IDRX/USDC": { reserveFrom: 1_000_000n, reserveTo: 640_000n },
  };
  const source = new ConstantProductPriceSource(pools);

  test("a small swap prices near the marginal rate", async () => {
    // 1.00 whole IDRX (100 minor): out = 100*640_000/(1_000_000+100) = 63n
    // rate = 63*100/100 = 63 minor USDC per whole IDRX
    const quote = await source.price("IDRX", "USDC", money(100n, "IDRX"));
    expect(quote.scaledRate).toBe(63n * RATE_SCALE);
    expect(quote.source).toBe("constant-product");
  });

  test("a larger swap moves the price more — size-aware slippage", async () => {
    // 10,000.00 whole IDRX (1_000_000 minor): out = 1_000_000*640_000/2_000_000 = 320_000n
    // rate = 320_000*100/1_000_000 = 32 minor USDC per whole IDRX
    const quote = await source.price("IDRX", "USDC", money(1_000_000n, "IDRX"));
    expect(quote.scaledRate).toBe(32n * RATE_SCALE);
  });

  test("a fee reduces the output", async () => {
    // 0.64 USDC (640_000 minor) <-> 10,000.00 IDRX (1_000_000 minor). The fee
    // no longer has to move a whole minor unit to be visible — RATE_DECIMALS
    // resolves it directly.
    const feePools = { "USDC/IDRX": { reserveFrom: 640_000n, reserveTo: 1_000_000n } };
    const free = new ConstantProductPriceSource(feePools);
    const taxed = new ConstantProductPriceSource(feePools, { feeBps: 30 });
    // 0.10 whole USDC (100_000 minor).
    const freeQuote = await free.price("USDC", "IDRX", money(100_000n, "USDC"));
    const taxedQuote = await taxed.price("USDC", "IDRX", money(100_000n, "USDC"));
    expect(freeQuote.scaledRate).toBe(1_351_350_000_000_000n);
    expect(taxedQuote.scaledRate).toBe(1_347_840_000_000_000n);
    expect(taxedQuote.scaledRate).toBeLessThan(freeQuote.scaledRate);
  });

  test("a missing reverse pool throws — no symmetry inference", async () => {
    await expect(source.price("USDC", "IDRX", money(640_000n, "USDC"))).rejects.toBeInstanceOf(
      ConfigurationError,
    );
  });

  test("throws on a same-asset pair — identity is the router's job", async () => {
    await expect(source.price("IDRX", "IDRX", money(100n, "IDRX"))).rejects.toBeInstanceOf(
      ConfigurationError,
    );
  });
});

/** A source that throws if the router ever calls it — for same-asset tests. */
class ThrowingSource implements PriceSource {
  async price(from: AssetCode, to: AssetCode): Promise<PriceQuote> {
    throw new Error(`source should not be called for ${from} -> ${to}`);
  }
}

describe("LiquidityRouter", () => {
  test("same-asset quote is the identity rate and never calls the source", async () => {
    const router = new LiquidityRouter({ source: new ThrowingSource() });
    const quote = await router.quote("USDC", "USDC", money(1_000_000n, "USDC"));
    // one whole unit of USDC is 10^6 minor USDC, carrying RATE_DECIMALS
    expect(quote.scaledRate).toBe(10n ** BigInt(assetDecimals("USDC")) * RATE_SCALE);
    expect(quote.source).toBe("identity");
    expect(quote.from).toBe("USDC");
    expect(quote.to).toBe("USDC");
    expect(quote.expiresAt).toBeUndefined();
  });

  test("cross-asset quote delegates to the source and passes amount through", async () => {
    const router = new LiquidityRouter({ source: new StubSource() });
    const quote = await router.quote("IDRX", "USDC", money(5_000n, "IDRX"));
    // Whatever a source returns is already scaled; the port does not rescale.
    expect(quote.scaledRate).toBe(100n);
    expect(quote.source).toBe("stub");
  });

  test("surfaces the source's ConfigurationError for an unsupported pair", async () => {
    const router = new LiquidityRouter({ source: new TablePriceSource({ "IDRX/USDC": 100n }) });
    await expect(router.quote("USDC", "IDRX", money(1_000_000n, "USDC"))).rejects.toBeInstanceOf(
      ConfigurationError,
    );
  });
});
