import { describe, expect, test } from "bun:test";
import type { ChainId } from "@mayarin/chain";
import {
  type AssetCode,
  assetDecimals,
  ConfigurationError,
  money,
  RATE_SCALE,
} from "@mayarin/shared";
import {
  ConstantProductPriceSource,
  FallbackPriceSource,
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
    const quote = await source.price("USDT", "USDC", money(1_000n, "USDT"));

    expect(quote.from).toBe("USDT");
    expect(quote.to).toBe("USDC");
    // Whatever a source returns is already scaled; the port does not rescale.
    expect(quote.scaledRate).toBe(100n);
    expect(quote.source).toBe("stub");
    expect(quote.expiresAt).toBeUndefined();
  });

  test("price receives the amount being priced", async () => {
    const source = new StubSource();
    await source.price("USDT", "USDC", money(5_000n, "USDT"));
    expect(source.calls[0]?.amount).toBe(5_000n);
  });
});

describe("TablePriceSource", () => {
  const source = new TablePriceSource({ "USDT/USDC": 100_0000n });

  test("returns the configured rate for a cross-asset pair", async () => {
    const quote = await source.price("USDT", "USDC", money(10_000n, "USDT"));
    expect(quote.scaledRate).toBe(100_0000n * RATE_SCALE);
    expect(quote.source).toBe("table");
    expect(quote.from).toBe("USDT");
    expect(quote.to).toBe("USDC");
  });

  test("throws on a missing cross-asset pair", async () => {
    await expect(source.price("USDC", "USDT", money(1_000_000n, "USDC"))).rejects.toBeInstanceOf(
      ConfigurationError,
    );
  });

  test("throws on a same-asset pair — identity is the router's job", async () => {
    await expect(source.price("USDT", "USDT", money(10_000n, "USDT"))).rejects.toBeInstanceOf(
      ConfigurationError,
    );
  });

  test("carries a custom source label", async () => {
    const labelled = new TablePriceSource({ "USDT/USDC": 100_0000n }, "exchange-rates");
    const quote = await labelled.price("USDT", "USDC", money(10_000n, "USDT"));
    expect(quote.source).toBe("exchange-rates");
  });
});

describe("ConstantProductPriceSource", () => {
  // Pool: 1.000000 USDT (1_000_000 minor) <-> 0.640000 USDC (640_000 minor).
  // Marginal rate USDT->USDC = 640_000 minor USDC per whole USDT.
  const pools = {
    "USDT/USDC": { reserveFrom: 1_000_000n, reserveTo: 640_000n },
  };
  const source = new ConstantProductPriceSource(pools);

  test("a small swap prices near the marginal rate", async () => {
    // 0.000100 whole USDT (100 minor): out = 100*640_000/(1_000_000+100) = 63n
    // rate = 63*1_000_000/100 = 630_000 minor USDC per whole USDT
    const quote = await source.price("USDT", "USDC", money(100n, "USDT"));
    expect(quote.scaledRate).toBe(630_000n * RATE_SCALE);
    expect(quote.source).toBe("constant-product");
  });

  test("a larger swap moves the price more — size-aware slippage", async () => {
    // 1.000000 whole USDT (1_000_000 minor): out = 1_000_000*640_000/2_000_000 = 320_000n
    // rate = 320_000*1_000_000/1_000_000 = 320_000 minor USDC per whole USDT
    const quote = await source.price("USDT", "USDC", money(1_000_000n, "USDT"));
    expect(quote.scaledRate).toBe(320_000n * RATE_SCALE);
  });

  test("a fee reduces the output", async () => {
    // 0.640000 USDC (640_000 minor) <-> 1.000000 USDT (1_000_000 minor). The fee
    // no longer has to move a whole minor unit to be visible — RATE_DECIMALS
    // resolves it directly.
    const feePools = { "USDC/USDT": { reserveFrom: 640_000n, reserveTo: 1_000_000n } };
    const free = new ConstantProductPriceSource(feePools);
    const taxed = new ConstantProductPriceSource(feePools, { feeBps: 30 });
    // 0.10 whole USDC (100_000 minor).
    const freeQuote = await free.price("USDC", "USDT", money(100_000n, "USDC"));
    const taxedQuote = await taxed.price("USDC", "USDT", money(100_000n, "USDC"));
    expect(freeQuote.scaledRate).toBe(1_351_350_000_000_000n);
    expect(taxedQuote.scaledRate).toBe(1_347_840_000_000_000n);
    expect(taxedQuote.scaledRate).toBeLessThan(freeQuote.scaledRate);
  });

  test("a missing reverse pool throws — no symmetry inference", async () => {
    await expect(source.price("USDC", "USDT", money(640_000n, "USDC"))).rejects.toBeInstanceOf(
      ConfigurationError,
    );
  });

  test("throws on a same-asset pair — identity is the router's job", async () => {
    await expect(source.price("USDT", "USDT", money(100n, "USDT"))).rejects.toBeInstanceOf(
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
    const quote = await router.quote("USDT", "USDC", money(5_000n, "USDT"));
    // Whatever a source returns is already scaled; the port does not rescale.
    expect(quote.scaledRate).toBe(100n);
    expect(quote.source).toBe("stub");
  });

  test("surfaces the source's ConfigurationError for an unsupported pair", async () => {
    const router = new LiquidityRouter({ source: new TablePriceSource({ "USDT/USDC": 100n }) });
    await expect(router.quote("USDC", "USDT", money(1_000_000n, "USDC"))).rejects.toBeInstanceOf(
      ConfigurationError,
    );
  });
});

/** A source that only prices one chain, as a chain-specific venue does. */
class OneChainSource implements PriceSource {
  readonly calls: ChainId[] = [];

  constructor(
    private readonly chain: ChainId,
    private readonly rate: bigint,
  ) {}

  async price(from: AssetCode, to: AssetCode, _amount: unknown, chain?: ChainId) {
    if (chain !== undefined) this.calls.push(chain);
    if (chain !== undefined && chain !== this.chain) {
      throw new ConfigurationError(`pool is on ${this.chain}, not ${chain}`, { chain });
    }
    return { from, to, scaledRate: this.rate, source: this.chain };
  }
}

describe("FallbackPriceSource", () => {
  test("prices through the venue whose pool is on the payment's chain", async () => {
    const base = new OneChainSource("base-sepolia", 742_458n);
    const arc = new OneChainSource("arc-testnet", 1_408_170n);

    const quote = await new FallbackPriceSource([base, arc]).price(
      "EURC",
      "USDC",
      money(1_000_000n, "EURC"),
      "arc-testnet",
    );

    // The bug this exists for: without the fallback the Base pool priced an
    // Arc payment, and the lock carried a rate the swap could never reproduce.
    expect(quote.scaledRate).toBe(1_408_170n);
    expect(quote.source).toBe("arc-testnet");
    expect(base.calls).toEqual(["arc-testnet"]);
  });

  test("stops at the first source that can price", async () => {
    const base = new OneChainSource("base-sepolia", 742_458n);
    const arc = new OneChainSource("arc-testnet", 1_408_170n);

    await new FallbackPriceSource([base, arc]).price(
      "EURC",
      "USDC",
      money(1_000_000n, "EURC"),
      "base-sepolia",
    );

    expect(arc.calls).toEqual([]);
  });

  test("with no chain named, the first source prices", async () => {
    const base = new OneChainSource("base-sepolia", 742_458n);
    const arc = new OneChainSource("arc-testnet", 1_408_170n);

    const quote = await new FallbackPriceSource([base, arc]).price(
      "EURC",
      "USDC",
      money(1_000_000n, "EURC"),
    );

    expect(quote.scaledRate).toBe(742_458n);
  });

  // A venue outage is not a reason to price against a different chain's pool.
  test("rethrows a non-configuration failure", async () => {
    const broken: PriceSource = {
      price: () => Promise.reject(new Error("RPC timeout")),
    };
    const arc = new OneChainSource("arc-testnet", 1_408_170n);

    expect(
      new FallbackPriceSource([broken, arc]).price(
        "EURC",
        "USDC",
        money(1_000_000n, "EURC"),
        "arc-testnet",
      ),
    ).rejects.toThrow("RPC timeout");
  });

  test("no source can price the chain — the last refusal stands", async () => {
    const base = new OneChainSource("base-sepolia", 742_458n);

    expect(
      new FallbackPriceSource([base]).price("EURC", "USDC", money(1n, "EURC"), "arc-testnet"),
    ).rejects.toThrow(ConfigurationError);
  });

  test("no sources at all throws ConfigurationError", async () => {
    expect(
      new FallbackPriceSource([]).price("EURC", "USDC", money(1n, "EURC"), "arc-testnet"),
    ).rejects.toThrow(ConfigurationError);
  });
});

describe("LiquidityRouter chain", () => {
  test("passes the payment's chain to the source", async () => {
    const arc = new OneChainSource("arc-testnet", 1_408_170n);
    const router = new LiquidityRouter({ source: arc });

    await router.quote("EURC", "USDC", money(1_000_000n, "EURC"), "arc-testnet");

    expect(arc.calls).toEqual(["arc-testnet"]);
  });
});
