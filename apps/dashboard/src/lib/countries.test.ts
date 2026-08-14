import { describe, expect, test } from "bun:test";
import { COUNTRIES, countryLabel, SUPPORTED_COUNTRIES } from "./countries";

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

  test("every supported code is a real entry in the list", () => {
    const codes = new Set(COUNTRIES.map((country) => country.code));
    for (const code of SUPPORTED_COUNTRIES) {
      expect(codes.has(code)).toBe(true);
    }
  });
});

describe("what a merchant can pick", () => {
  test("the United States and Southeast Asia are selectable", () => {
    const selectable = COUNTRIES.filter((country) => country.supported).map((c) => c.code);
    expect(selectable).toContain("US");
    expect(selectable).toContain("ID");
    expect(selectable).toContain("SG");
    expect(selectable).toContain("VN");
  });

  test("everywhere else is listed but not selectable", () => {
    // Disabled rather than hidden: hiding says "this country does not exist",
    // disabling says "not yet", which is the true statement.
    const japan = COUNTRIES.find((country) => country.code === "JP");
    expect(japan?.supported).toBe(false);
    expect(japan).toBeDefined();
  });

  test("supported countries sort ahead of the rest", () => {
    // So the eleven a merchant can actually choose are the ones on screen
    // before they type anything.
    const firstUnsupported = COUNTRIES.findIndex((country) => !country.supported);
    const lastSupported = COUNTRIES.map((c) => c.supported).lastIndexOf(true);
    expect(lastSupported).toBeLessThan(firstUnsupported);
    expect(firstUnsupported).toBe(SUPPORTED_COUNTRIES.length);
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
