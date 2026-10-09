import { describe, expect, test } from "bun:test";
import { money, ProviderError, ValidationError } from "@mayarin/shared";
import {
  type OrcaQuoteReader,
  type OrcaQuoteReadRequest,
  type OrcaQuoteReadResult,
  OrcaSolanaSwapVenue,
  SOLANA_WRAPPED_NATIVE_MINT,
} from "../src/index.ts";

const USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const USDG_MINT = "H1hMJToegAs8mXt23eVuwKJb17fz4N5emZBCzAvmBF6R";
const USDT_MINT = "8PtqaCwyS3JT1JfJgkKsFnYRkftQLpRc2kvxebxMUuus";
const POOL = "5raasGCxqaEvGsvQ1PvGxRB1JYnA7Y3L4LfjRCfkNJ4f";
const USDG_POOL = "LkKtkAzT4kjfwv6objWTRXo4pLpBUmdEJyJ9Uy2zHsM";
const USDT_POOL = "6L9dVPZZbvm4jGxPCgrKfiGsnJaQTS5562UEGcRVZyow";

class FixedReader implements OrcaQuoteReader {
  readonly calls: OrcaQuoteReadRequest[] = [];
  readonly #result: OrcaQuoteReadResult;

  constructor(result: OrcaQuoteReadResult) {
    this.#result = result;
  }

  async quote(request: OrcaQuoteReadRequest): Promise<OrcaQuoteReadResult> {
    this.calls.push(request);
    return this.#result;
  }
}

function venue(reader: OrcaQuoteReader) {
  return new OrcaSolanaSwapVenue({
    rpcUrls: { "solana-devnet": "https://api.devnet.solana.com" },
    pools: {
      "solana-devnet": [
        { address: POOL, tokenMintA: SOLANA_WRAPPED_NATIVE_MINT, tokenMintB: USDC_MINT },
        {
          address: USDG_POOL,
          tokenMintA: USDC_MINT,
          tokenMintB: USDG_MINT,
        },
        {
          address: USDT_POOL,
          tokenMintA: USDC_MINT,
          tokenMintB: USDT_MINT,
        },
      ],
    },
    assets: { "solana-devnet": { USDC: USDC_MINT, USDG: USDG_MINT, USDT: USDT_MINT } },
    nativeAssets: { "solana-devnet": "SOL" },
    reader,
  });
}

describe("OrcaSolanaSwapVenue", () => {
  test("prices an exact-output SOL payment from the configured Whirlpool", async () => {
    const reader = new FixedReader({ amountIn: 362_581_581n, amountOut: 5_000_000n });
    const orca = venue(reader);

    const quote = await orca.quoteExactOutput(
      "SOL",
      "USDC",
      money(5_000_000n, "USDC"),
      "solana-devnet",
    );

    expect(quote.source).toBe("orca");
    expect(quote.scaledRate).toBeGreaterThan(13_000_000n * 1_000_000_000n);
    expect(reader.calls[0]).toMatchObject({
      inputMint: SOLANA_WRAPPED_NATIVE_MINT,
      outputMint: USDC_MINT,
      amount: 5_000_000n,
      amountSpecified: "output",
    });
  });

  test("prices an exact-input quote without converting through numbers", async () => {
    const reader = new FixedReader({ amountIn: 100_000_000n, amountOut: 1_379_000n });
    const quote = await venue(reader).quote(
      "SOL",
      "USDC",
      money(100_000_000n, "SOL"),
      "solana-devnet",
    );

    expect(quote.scaledRate).toBe(13_790_000_000_000_000n);
  });

  test.each([
    ["USDG", USDG_MINT],
    ["USDT", USDT_MINT],
  ] as const)("prices an exact-output %s surrogate payment", async (asset, mint) => {
    const reader = new FixedReader({ amountIn: 10_102n, amountOut: 10_000n });

    const quote = await venue(reader).quoteExactOutput(
      asset,
      "USDC",
      money(10_000n, "USDC"),
      "solana-devnet",
    );

    expect(quote.source).toBe("orca");
    expect(reader.calls[0]).toMatchObject({
      inputMint: mint,
      outputMint: USDC_MINT,
      amountSpecified: "output",
    });
  });

  test("rejects an extrapolated thin-pool stablecoin quote", async () => {
    const reader = new FixedReader({ amountIn: 20_000_000_000n, amountOut: 10_000n });

    await expect(
      venue(reader).quoteExactOutput("USDT", "USDC", money(10_000n, "USDC"), "solana-devnet"),
    ).rejects.toThrow(/stablecoin quote.*out of bounds/i);
  });

  test("validates the amount asset before reading the pool", async () => {
    const reader = new FixedReader({ amountIn: 1n, amountOut: 1n });

    await expect(
      venue(reader).quote("SOL", "USDC", money(1_000_000n, "USDC"), "solana-devnet"),
    ).rejects.toThrow(ValidationError);
    expect(reader.calls).toHaveLength(0);
  });

  test("turns RPC failures into retryable provider errors", async () => {
    const reader: OrcaQuoteReader = {
      quote: async () => {
        throw new Error("RPC unavailable");
      },
    };

    try {
      await venue(reader).quote("SOL", "USDC", money(100_000_000n, "SOL"), "solana-devnet");
      throw new Error("expected quote to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderError);
      if (!(error instanceof ProviderError)) throw error;
      expect(error.retryable).toBe(true);
    }
  });
});
