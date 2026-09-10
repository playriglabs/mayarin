import { describe, expect, test } from "bun:test";
import { withPayerCountry } from "../src/payer-country.ts";

describe("withPayerCountry", () => {
  test("stores a normalized ISO country without retaining an IP", () => {
    expect(withPayerCountry({ order: "42" }, " id ")).toEqual({
      order: "42",
      payerCountryCode: "ID",
    });
  });

  test("leaves metadata alone for Cloudflare's non-country values", () => {
    expect(withPayerCountry(undefined, undefined)).toBeUndefined();
    expect(withPayerCountry({ order: "42" }, "XX")).toEqual({ order: "42" });
    expect(withPayerCountry({ order: "42" }, "T1")).toEqual({ order: "42" });
  });
});
