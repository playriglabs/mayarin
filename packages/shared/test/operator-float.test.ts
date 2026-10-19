import { describe, expect, test } from "bun:test";
import type { AssetCode } from "../src/asset.ts";
import { type FloatReader, OperatorFloatMonitor } from "../src/operator-float.ts";

const holding = (balances: Record<string, bigint>): FloatReader => ({
  balance: async (chain: string, asset: AssetCode) => balances[`${chain}:${asset}`] ?? 0n,
});

describe("OperatorFloatMonitor", () => {
  const limits = {
    "base-sepolia": { ETH: { min: "0.005" }, USDC: { max: "500" } },
  };

  test("a balance inside its limits reports nothing", async () => {
    const monitor = new OperatorFloatMonitor(
      holding({ "base-sepolia:ETH": 10n ** 16n, "base-sepolia:USDC": 100_000_000n }),
      limits,
    );
    expect(await monitor.run()).toEqual([]);
  });

  test("more than the ceiling is reported, so a compromise cannot take more than it", async () => {
    const monitor = new OperatorFloatMonitor(
      holding({ "base-sepolia:ETH": 10n ** 16n, "base-sepolia:USDC": 501_000_000n }),
      limits,
    );
    expect(await monitor.run()).toEqual([
      {
        type: "operator-float",
        finding: "above-max",
        chain: "base-sepolia",
        asset: "USDC",
        balance: "501000000",
        limit: "500000000",
      },
    ]);
  });

  test("native currency under its floor is reported, because the operator can no longer pay gas", async () => {
    const monitor = new OperatorFloatMonitor(holding({ "base-sepolia:ETH": 1_000n }), limits);
    const [found] = await monitor.run();
    expect(found).toMatchObject({ finding: "below-min", asset: "ETH", limit: "5000000000000000" });
  });

  test("each breach is its own finding, on every pass", async () => {
    const monitor = new OperatorFloatMonitor(
      holding({ "base-sepolia:USDC": 600_000_000n }),
      limits,
    );
    expect(await monitor.run()).toHaveLength(2);
    expect(await monitor.run()).toHaveLength(2);
  });

  test("a limit that is not an amount of its asset is refused at construction", () => {
    expect(() => new OperatorFloatMonitor(holding({}), { x: { USDC: { max: "lots" } } })).toThrow(
      "not an amount",
    );
    expect(
      () => new OperatorFloatMonitor(holding({}), { x: { USDC: { max: "1.0000001" } } }),
    ).toThrow("not an amount");
    expect(() => new OperatorFloatMonitor(holding({}), { x: { USDC: {} } })).toThrow(
      "min or a max",
    );
    expect(
      () => new OperatorFloatMonitor(holding({}), { x: { USDC: { min: "5", max: "1" } } }),
    ).toThrow("above its maximum");
  });
});
