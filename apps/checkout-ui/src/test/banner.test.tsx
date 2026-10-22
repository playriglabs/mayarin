import { afterEach, describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { TestnetBanner } from "../shared/checkout-shell.tsx";

type WithWindow = { window?: { __BOOTSTRAP__?: { network?: string } } };

afterEach(() => {
  delete (globalThis as WithWindow).window;
});

describe("TestnetBanner", () => {
  test("shows on a testnet, and when the API did not say", () => {
    expect(renderToString(<TestnetBanner />)).toContain("Mayarin Testnet");
    (globalThis as WithWindow).window = { __BOOTSTRAP__: { network: "testnet" } };
    expect(renderToString(<TestnetBanner />)).toContain("Mayarin Testnet");
    (globalThis as WithWindow).window = { __BOOTSTRAP__: {} };
    expect(renderToString(<TestnetBanner />)).toContain("Mayarin Testnet");
  });

  test("says nothing on a mainnet", () => {
    (globalThis as WithWindow).window = { __BOOTSTRAP__: { network: "mainnet" } };
    expect(renderToString(<TestnetBanner />)).toBe("");
  });
});
