import { describe, expect, test } from "bun:test";
import { chainLogoUrl } from "@mayarin/chain";
import { NETWORKS } from "../src/components/landing/network-marks.tsx";

describe("landing network marks", () => {
  test("shows Polygon with its local mark, which exists on disk", async () => {
    const polygon = NETWORKS.find((network) => network.name === "Polygon");

    expect(polygon?.src).toBe("/chains/polygon.svg");
    expect(await Bun.file(new URL("../public/chains/polygon.svg", import.meta.url)).exists()).toBe(
      true,
    );
  });

  test("shows Solana with the canonical chain logo", () => {
    expect(NETWORKS).toContainEqual({
      name: "Solana",
      src: chainLogoUrl("solana-devnet"),
    });
  });
});
