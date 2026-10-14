import { describe, expect, test } from "bun:test";
import { localRailsFor } from "./local-rails.ts";

describe("localRailsFor", () => {
  test("lists the rails of a supported market", () => {
    expect(localRailsFor("PH")).toContain("GCash");
    expect(localRailsFor("ID")).toContain("QRIS");
    expect(localRailsFor("MY")).toContain("FPX");
    expect(localRailsFor("BR")).toContain("Pix");
  });

  test("promises nothing for a country with no local rail", () => {
    expect(localRailsFor("SG")).toEqual([]);
    expect(localRailsFor("")).toEqual([]);
  });
});
