import { describe, expect, test } from "bun:test";
import { parseBirthDate } from "../features/pay/birth-date.ts";

describe("parseBirthDate", () => {
  test("formats a real date as DD-MM-YYYY", () => {
    expect(parseBirthDate("5", "9", "1992", 2026)).toBe("05-09-1992");
    expect(parseBirthDate("27", "09", "2002", 2026)).toBe("27-09-2002");
  });

  test("accepts a leap day only in a leap year", () => {
    expect(parseBirthDate("29", "2", "2000", 2026)).toBe("29-02-2000");
    expect(parseBirthDate("29", "2", "2001", 2026)).toBeUndefined();
  });

  test("refuses a day that rolls into the next month", () => {
    expect(parseBirthDate("31", "4", "1990", 2026)).toBeUndefined();
    expect(parseBirthDate("0", "1", "1990", 2026)).toBeUndefined();
    expect(parseBirthDate("1", "13", "1990", 2026)).toBeUndefined();
  });

  test("refuses a year in the future, before 1900, or not four digits", () => {
    expect(parseBirthDate("1", "1", "2027", 2026)).toBeUndefined();
    expect(parseBirthDate("1", "1", "1899", 2026)).toBeUndefined();
    expect(parseBirthDate("1", "1", "92", 2026)).toBeUndefined();
  });

  test("refuses anything that is not a number", () => {
    expect(parseBirthDate("", "1", "1990", 2026)).toBeUndefined();
    expect(parseBirthDate("1a", "1", "1990", 2026)).toBeUndefined();
  });
});
