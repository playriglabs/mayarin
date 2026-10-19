import { afterEach, describe, expect, test } from "bun:test";
import { formatUsdCents, setDisplayCurrency } from "./display-currency";

afterEach(() => setDisplayCurrency({ currency: "USD", perUsd: "1" }));

describe("formatUsdCents", () => {
  test("dollars are left as they were", () => {
    expect(formatUsdCents(839n)).toBe("$ 8,39");
  });

  test("converts at the rate the API sent, with no float in between", () => {
    setDisplayCurrency({ currency: "IDR", perUsd: "16000.00000000" });
    // 8.39 USD * 16 000 = 134 240 rupiah
    expect(formatUsdCents(839n)).toContain("134.240");
    expect(formatUsdCents(839n)).toContain("Rp");
  });

  test("a currency with no minor unit has none", () => {
    setDisplayCurrency({ currency: "JPY", perUsd: "150.5" });
    expect(formatUsdCents(1_000n)).toContain("1.505");
    expect(formatUsdCents(1_000n)).not.toContain(",");
  });

  test("a currency worth more than a dollar keeps its cents", () => {
    setDisplayCurrency({ currency: "EUR", perUsd: "0.9" });
    expect(formatUsdCents(1_000n)).toContain("9,00");
  });
});
