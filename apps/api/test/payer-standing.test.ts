import { describe, expect, test } from "bun:test";
import { DEFAULT_DISPUTE_STANDING } from "../src/market.ts";
import { standingOf } from "../src/services/payer-standing.ts";
import { createApiHarness } from "./harness.ts";

const rules = DEFAULT_DISPUTE_STANDING;

describe("payer standing (#314)", () => {
  test("a wallet with no history, or one dispute it won, is in good standing", () => {
    expect(standingOf({ escrowed: 0, disputes: 0, lost: 0 }, rules)).toBe("good");
    expect(standingOf({ escrowed: 1, disputes: 1, lost: 0 }, rules)).toBe("good");
  });

  test("two lost disputes flag the wallet", () => {
    expect(standingOf({ escrowed: 10, disputes: 1, lost: 1 }, rules)).toBe("good");
    expect(standingOf({ escrowed: 10, disputes: 2, lost: 2 }, rules)).toBe("flagged");
  });

  test("disputing more than half of its payments flags a wallet once past the minimum sample", () => {
    expect(standingOf({ escrowed: 3, disputes: 3, lost: 0 }, rules)).toBe("good");
    expect(standingOf({ escrowed: 4, disputes: 2, lost: 0 }, rules)).toBe("good");
    expect(standingOf({ escrowed: 4, disputes: 3, lost: 0 }, rules)).toBe("flagged");
  });
});

describe("GET /v1/payers/:address/protection (#314)", () => {
  test("answers whether the wallet may take protection, and nothing more", async () => {
    const harness = createApiHarness();
    const response = await harness.app.request(
      "/v1/payers/0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0/protection",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ eligible: true });
  });

  test("refuses something that is not an address", async () => {
    const harness = createApiHarness();
    const response = await harness.app.request("/v1/payers/not-a-wallet/protection");
    expect(response.status).toBe(400);
  });
});
