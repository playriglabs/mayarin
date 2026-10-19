import { describe, expect, test } from "bun:test";
import { COUNTRIES } from "./countries";
import { currencyOfCountry } from "./country-currency";

describe("currencyOfCountry", () => {
  test("every country a merchant can pick has a currency of its own", () => {
    for (const country of COUNTRIES) {
      expect(currencyOfCountry(country.code)).toMatch(/^[A-Z]{3}$/);
    }
  });

  test("a few that are easy to get wrong", () => {
    expect(currencyOfCountry("ID")).toBe("IDR");
    expect(currencyOfCountry("DE")).toBe("EUR");
    expect(currencyOfCountry("EC")).toBe("USD");
  });
});
