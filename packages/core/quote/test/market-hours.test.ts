import { describe, expect, test } from "bun:test";
import { isFxMarketOpen } from "../src/market-hours.ts";

describe("isFxMarketOpen", () => {
  test("trades through the middle of the week", () => {
    // Tuesday, Wednesday, Thursday — no session boundary anywhere near them.
    expect(isFxMarketOpen(new Date("2026-08-04T03:00:00.000Z"))).toBe(true);
    expect(isFxMarketOpen(new Date("2026-08-05T12:00:00.000Z"))).toBe(true);
    expect(isFxMarketOpen(new Date("2026-08-06T23:00:00.000Z"))).toBe(true);
  });

  test("closes at the Friday New York close and stays shut all Saturday", () => {
    expect(isFxMarketOpen(new Date("2026-08-07T20:59:59.000Z"))).toBe(true);
    expect(isFxMarketOpen(new Date("2026-08-07T21:00:00.000Z"))).toBe(false);
    expect(isFxMarketOpen(new Date("2026-08-08T00:00:00.000Z"))).toBe(false);
    expect(isFxMarketOpen(new Date("2026-08-08T12:00:00.000Z"))).toBe(false);
    expect(isFxMarketOpen(new Date("2026-08-08T23:59:59.000Z"))).toBe(false);
  });

  test("reopens at the Sunday Sydney open", () => {
    expect(isFxMarketOpen(new Date("2026-08-09T20:59:59.000Z"))).toBe(false);
    expect(isFxMarketOpen(new Date("2026-08-09T21:00:00.000Z"))).toBe(true);
  });

  test("Monday before the hour of the weekly boundaries is still open", () => {
    // The open and close share an hour-of-day, so a naive implementation that
    // compared only the hour would shut the market every weekday morning.
    expect(isFxMarketOpen(new Date("2026-08-10T02:00:00.000Z"))).toBe(true);
  });
});
