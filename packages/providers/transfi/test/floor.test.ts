import { describe, expect, test } from "bun:test";
import { methodFloor, minimumFitsPayment } from "../src/amount.ts";

describe("methodFloor", () => {
  test("a method whose listed minimum is real is read from one quote", async () => {
    const floor = await methodFloor({
      listedMin: 200,
      quote: async (amount) => ({ destinationAmount: amount / 64.7 }),
    });
    expect(floor?.floor).toBe(200);
    expect(floor?.delivered).toBeCloseTo(3.09, 2);
  });

  test("a listed minimum the quote refuses is replaced by the floor it names (QRIS: listed 1, real 92,015)", async () => {
    const asked: number[] = [];
    const floor = await methodFloor({
      listedMin: 1,
      quote: async (amount) => {
        asked.push(amount);
        return amount < 92_015
          ? { destinationAmount: 0, belowMinimum: 92_015 }
          : { destinationAmount: amount / 18_478 };
      },
    });
    expect(asked).toEqual([1, 92_015]);
    expect(floor?.floor).toBe(92_015);
    expect(floor?.delivered).toBeCloseTo(4.98, 2);
  });

  test("when nothing can be priced it says so rather than guess", async () => {
    expect(await methodFloor({ listedMin: 1, quote: async () => ({ destinationAmount: 0 }) })).toBe(
      undefined,
    );
    expect(
      await methodFloor({
        listedMin: 1,
        quote: async () => ({ destinationAmount: 0, belowMinimum: 50 }),
      }),
    ).toBe(undefined);
  });
});

describe("minimumFitsPayment", () => {
  const floor = { floor: 92_015, delivered: 4.98 };

  test("a payment that the minimum would overcharge by a third does not fit", () => {
    expect(minimumFitsPayment(floor, 4.0, 1.05)).toBe(false);
  });

  test("a payment at or just under the minimum fits, within rounding", () => {
    expect(minimumFitsPayment(floor, 4.98, 1.05)).toBe(true);
    expect(minimumFitsPayment(floor, 4.8, 1.05)).toBe(true);
    expect(minimumFitsPayment(floor, 25, 1.05)).toBe(true);
  });
});
