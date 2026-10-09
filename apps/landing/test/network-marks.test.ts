import { describe, expect, test } from "bun:test";
import { chainLogoUrl } from "@mayarin/chain";
import { NETWORKS } from "../src/components/landing/network-marks.tsx";

describe("landing network marks", () => {
  test("shows Solana with the canonical chain logo", () => {
    expect(NETWORKS).toContainEqual({
      name: "Solana",
      src: chainLogoUrl("solana-devnet"),
    });
  });
});
