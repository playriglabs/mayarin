import { describe, expect, test } from "bun:test";
import { fundsArrived } from "./clearing";

const through = (...states: string[]) => states.map((state) => ({ state }));

describe("fundsArrived", () => {
  test("is true once the history reached ASSET_RECEIVED, even if it failed after", () => {
    expect(fundsArrived(through("CREATED", "PAYMENT_PENDING", "ASSET_RECEIVED", "FAILED"))).toBe(
      true,
    );
  });

  test("is false for a payment that failed with nothing received", () => {
    expect(fundsArrived(through("CREATED", "PRICE_LOCKED", "PAYMENT_PENDING", "FAILED"))).toBe(
      false,
    );
    expect(fundsArrived([])).toBe(false);
  });
});
