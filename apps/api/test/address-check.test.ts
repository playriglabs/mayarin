import { describe, expect, test } from "bun:test";
import { badChecksumAddresses } from "../src/address-check.ts";

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
