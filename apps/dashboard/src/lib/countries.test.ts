import { describe, expect, test } from "bun:test";
import { COUNTRIES, countryLabel } from "./countries";

describe("country codes", () => {
  test("every code is ISO 3166-1 alpha-2", () => {
    // The payment API validates `countryCode: z.string().length(2)`. A
    // three-letter code would save from the settings form and then fail every
    // payment-link creation, so the list may never carry one.
    for (const country of COUNTRIES) {
      expect(country.code).toMatch(/^[A-Z]{2}$/);
    }
  });

  test("the United States is US, not USA", () => {
    const codes = COUNTRIES.map((country) => country.code);
    expect(codes).toContain("US");
    expect(codes).not.toContain("USA");
  });

  test("no country is listed twice", () => {
    const codes = COUNTRIES.map((country) => country.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("what a merchant can pick", () => {
  test("every country, alphabetical by name", () => {
    const names = COUNTRIES.map((country) => country.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(COUNTRIES.map((country) => country.code)).toContain("JP");
  });
});

describe("labels", () => {
  test("read as `code - name`", () => {
    expect(countryLabel("ID")).toBe("ID - Indonesia");
    expect(countryLabel("US")).toBe("US - United States");
  });

  test("a lowercase code still resolves", () => {
    expect(countryLabel("sg")).toBe("SG - Singapore");
  });

  test("an unknown code shows as itself rather than blank", () => {
    expect(countryLabel("ZZ")).toBe("ZZ");
  });
});
