import { describe, expect, test } from "bun:test";
import { badChecksumAddresses } from "../src/address-check.ts";
import { returnAddressSchema } from "../src/dto/payment-intent.ts";

const WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
const WBNB_LOST_A_CAPITAL = "0xbb4CdB9CBd36B01bD1cBaEBF2de08d9173bc095c";

describe("badChecksumAddresses", () => {
  test("finds an address whose mixed case is not its checksum, wherever it sits", () => {
    const pools = { bsc: [{ tokenIn: WBNB_LOST_A_CAPITAL, tokenOut: WBNB, fee: 500 }] };

    expect(badChecksumAddresses(pools)).toEqual([WBNB_LOST_A_CAPITAL]);
  });

  test("accepts a checksum address, an all-lowercase one, and non-address strings", () => {
    expect(badChecksumAddresses({ a: WBNB, b: WBNB.toLowerCase(), c: "bsc", d: 500 })).toEqual([]);
  });
});

describe("returnAddressSchema", () => {
  test("takes an EVM address and refuses a mistyped capital, a short string and a Solana key", () => {
    expect(returnAddressSchema.safeParse(WBNB).success).toBe(true);
    expect(returnAddressSchema.safeParse(WBNB.toLowerCase()).success).toBe(true);
    expect(returnAddressSchema.safeParse(WBNB_LOST_A_CAPITAL).success).toBe(false);
    expect(returnAddressSchema.safeParse("0x1234").success).toBe(false);
    expect(
      returnAddressSchema.safeParse("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin").success,
    ).toBe(false);
  });
});
