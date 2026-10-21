import { describe, expect, test } from "bun:test";
import { ProviderError } from "@mayarin/shared";
import { gasFeePricer } from "../src/gas-fee.ts";
import type { PaymentApiClient, QuoteView } from "../src/services/payment-api-client.ts";

/** A payment API that says one dollar buys `perDollar` minor units of ETH. */
function api(perDollar: string | null): PaymentApiClient {
  const view: QuoteView = {
    source: { display: "$1.00" },
    indicative: true,
    quotes: [
      perDollar === null
        ? { asset: "ETH", amount: null, available: false }
        : { asset: "ETH", amount: { amount: perDollar, display: "" }, available: true },
    ],
  };
  return { quote: async () => view } as unknown as PaymentApiClient;
}

describe("gasFeePricer", () => {
  test("prices native gas in the stablecoin withdrawn, at the rate one dollar buys", async () => {
    // $2,000 per ETH: one dollar buys 5e14 wei. 0.0001 ETH of gas is 20 cents.
    const fee = await gasFeePricer(
      api("500000000000000"),
      "base",
      "ETH",
    )({
      cost: 10n ** 14n,
      asset: "USDC",
    });

    expect(fee).toBe(200_000n);
  });

  test("rounds up, so the operator is never left short by the division", async () => {
    // 1 wei at 1e13 wei per dollar is a hundred-billionth of a cent: 1 minor unit, not 0.
    const fee = await gasFeePricer(
      api("10000000000000"),
      "base",
      "ETH",
    )({
      cost: 1n,
      asset: "USDC",
    });

    expect(fee).toBe(1n);
  });

  test("a chain that burns a dollar stablecoin for gas is priced by its decimals, with no quote", async () => {
    // Arc: gas is USDC with 18 decimals, the token has 6. 0.002 USDC of gas.
    const noQuote = { quote: async () => ({ quotes: [] }) } as unknown as PaymentApiClient;
    const fee = await gasFeePricer(
      noQuote,
      "arc-testnet",
      "USDC",
    )({
      cost: 2n * 10n ** 15n,
      asset: "USDC",
    });

    expect(fee).toBe(2_000n);
  });

  test("refuses rather than naming a fee when the native rate is unavailable", async () => {
    await expect(
      gasFeePricer(api(null), "base", "ETH")({ cost: 10n ** 14n, asset: "USDC" }),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});
