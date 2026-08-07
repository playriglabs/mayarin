import { describe, expect, test } from "bun:test";
import type { PriceQuote } from "@mayarin/clearing";
import {
  ConfigurationError,
  isMayarinError,
  money,
  ProviderError,
  ValidationError,
} from "@mayarin/shared";
import {
  DEFAULT_STRATEGY_POLICIES,
  type StrategyPolicies,
  type SwapVenue,
  selectVenue,
} from "../src/index.ts";
import { FixedSwapVenue } from "../testing/index.ts";

const ONE_ETH = money(10n ** 18n, "ETH");

function ethUsdc(source: string, rate: bigint): PriceQuote {
  return { from: "ETH", to: "USDC", scaledRate: rate, source };
}

function venue(name: string, rate: bigint): FixedSwapVenue {
  return new FixedSwapVenue(name, [ethUsdc(name, rate)]);
}

function failingVenue(name: string): SwapVenue {
  return {
    name,
    quote: () => Promise.reject(new ProviderError(`${name} is down`, {}, { retryable: true })),
  };
}

/** Wraps a venue so its answer arrives after `ms`, to make latency observable. */
function delayedVenue(inner: SwapVenue, ms: number): SwapVenue {
  return {
    name: inner.name,
    quote: (from, to, amount) =>
      new Promise((resolve, reject) => {
        setTimeout(() => inner.quote(from, to, amount).then(resolve, reject), ms);
      }),
  };
}

describe("selectVenue, batched (best-quote)", () => {
  test("picks the venue with the best minOut across all venues", async () => {
    const venues = [venue("0x", 3_690_000_000n), venue("uniswap", 3_700_000_000n)];
    const selection = await selectVenue(venues, "ETH", "USDC", ONE_ETH, "batched");

    expect(selection.venue.name).toBe("uniswap");
    expect(selection.quote.scaledRate).toBe(3_700_000_000n);
  });

  test("asks every venue with the payment amount", async () => {
    const a = venue("0x", 3_690_000_000n);
    const b = venue("uniswap", 3_700_000_000n);
    await selectVenue([a, b], "ETH", "USDC", ONE_ETH, "batched");

    expect(a.calls).toEqual([{ from: "ETH", to: "USDC", amount: 10n ** 18n }]);
    expect(b.calls).toEqual([{ from: "ETH", to: "USDC", amount: 10n ** 18n }]);
  });

  test("equal quotes select the venue that is configured first", async () => {
    const venues = [venue("0x", 3_700_000_000n), venue("uniswap", 3_700_000_000n)];
    const selection = await selectVenue(venues, "ETH", "USDC", ONE_ETH, "batched");

    expect(selection.venue.name).toBe("0x");
  });

  test("one venue failure does not fail the selection", async () => {
    const venues = [failingVenue("0x"), venue("uniswap", 3_700_000_000n)];
    const selection = await selectVenue(venues, "ETH", "USDC", ONE_ETH, "batched");

    expect(selection.venue.name).toBe("uniswap");
  });

  test("waits for a slow venue when it has the better price", async () => {
    const venues = [
      venue("0x", 3_690_000_000n),
      delayedVenue(venue("uniswap", 3_700_000_000n), 15),
    ];
    const selection = await selectVenue(venues, "ETH", "USDC", ONE_ETH, "batched");

    expect(selection.venue.name).toBe("uniswap");
  });
});

describe("selectVenue, immediate (first-quote)", () => {
  test("takes the first venue that answers, not the best price", async () => {
    const venues = [
      delayedVenue(venue("uniswap", 3_700_000_000n), 15),
      venue("0x", 3_690_000_000n),
    ];
    const selection = await selectVenue(venues, "ETH", "USDC", ONE_ETH, "immediate");

    expect(selection.venue.name).toBe("0x");
    expect(selection.quote.scaledRate).toBe(3_690_000_000n);
  });

  test("a venue rejection drops out of the race", async () => {
    const venues = [failingVenue("0x"), venue("uniswap", 3_700_000_000n)];
    const selection = await selectVenue(venues, "ETH", "USDC", ONE_ETH, "immediate");

    expect(selection.venue.name).toBe("uniswap");
  });
});

describe("selectVenue, total failure", () => {
  test.each(["immediate", "batched"] as const)(
    "when every venue fails, %s throws a retryable ProviderError with each reason",
    async (strategy) => {
      const venues = [failingVenue("0x"), failingVenue("uniswap")];
      const selection = selectVenue(venues, "ETH", "USDC", ONE_ETH, strategy);

      expect(selection).rejects.toThrow(ProviderError);
      const error = await selection.catch((thrown: unknown) => thrown);
      if (!isMayarinError(error)) throw new Error("expected a MayarinError");
      expect(error.retryable).toBe(true);
      expect(error.details.failures).toEqual([
        { venue: "0x", reason: "0x is down" },
        { venue: "uniswap", reason: "uniswap is down" },
      ]);
    },
  );
});

describe("selectVenue, policy", () => {
  test("records the default MEV exposure per strategy", async () => {
    const venues = [venue("0x", 3_700_000_000n)];

    const pos = await selectVenue(venues, "ETH", "USDC", ONE_ETH, "immediate");
    expect(pos.strategy).toBe("immediate");
    expect(pos.mev).toBe("public-mempool");

    const batch = await selectVenue(venues, "ETH", "USDC", ONE_ETH, "batched");
    expect(batch.strategy).toBe("batched");
    expect(batch.mev).toBe("private-mempool");
  });

  test("a configured policy overrides the default table", async () => {
    const policies: StrategyPolicies = {
      ...DEFAULT_STRATEGY_POLICIES,
      immediate: { wait: "best-quote", mev: "private-mempool" },
    };
    const venues = [venue("0x", 3_690_000_000n), venue("uniswap", 3_700_000_000n)];
    const selection = await selectVenue(venues, "ETH", "USDC", ONE_ETH, "immediate", policies);

    expect(selection.venue.name).toBe("uniswap");
    expect(selection.mev).toBe("private-mempool");
  });
});

describe("selectVenue, validation", () => {
  test("no configured venue is a ConfigurationError", async () => {
    expect(selectVenue([], "ETH", "USDC", ONE_ETH, "batched")).rejects.toThrow(ConfigurationError);
  });

  test("an amount in a different asset than the payer asset is refused", async () => {
    expect(
      selectVenue([venue("0x", 1n)], "ETH", "USDC", money(1_000_000n, "USDC"), "batched"),
    ).rejects.toThrow(ValidationError);
  });

  test("a same-asset selection is refused — the planner owns the no-swap path", async () => {
    const v = venue("0x", 1n);
    expect(selectVenue([v], "USDC", "USDC", money(1_000_000n, "USDC"), "batched")).rejects.toThrow(
      ValidationError,
    );
    expect(v.calls).toHaveLength(0);
  });
});
