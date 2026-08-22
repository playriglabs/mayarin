/**
 * Pins the two rendered forms on the wire (#182).
 *
 * `formatted` is what a payer reproduces in a wallet: dot decimal, ungrouped.
 * `display` is what a person reads: the market's own convention, comma decimal
 * under `id-ID`. The checkout page shows crypto amounts from `formatted` and
 * fiat amounts from `display`; these tests keep the two forms from drifting
 * into each other.
 */

import { describe, expect, test } from "bun:test";
import { money } from "@mayarin/shared";
import { toMoneyDto } from "../src/dto/money.ts";

describe("money DTO", () => {
  test("a crypto amount carries a wallet-valid machine form beside the localized form", () => {
    const dto = toMoneyDto(money(3_500_000n, "USDC"));
    expect(dto.amount).toBe("3500000");
    expect(dto.formatted).toBe("3.500000");
    expect(dto.display).toBe("3,50 USDC");
  });

  test("a fiat amount keeps the locale form for display", () => {
    const dto = toMoneyDto(money(5_000_000n, "IDR"));
    expect(dto.formatted).toBe("50000.00");
    expect(dto.display).toBe("Rp 50.000,00");
  });
});
