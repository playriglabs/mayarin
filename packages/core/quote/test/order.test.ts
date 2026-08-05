import { describe, expect, test } from "bun:test";
import { money, ValidationError } from "@mayarin/shared";
import {
  assembleOrder,
  type LockedQuote,
  ORDER_DOMAIN_NAME,
  ORDER_DOMAIN_VERSION,
  ORDER_TYPE_STRING,
  type OrderContext,
  orderTypedData,
  orderTypeString,
  signOrder,
} from "../src/index.ts";
import { FakeOrderSigner } from "../testing/index.ts";

const INTENT_ID: `0x${string}` = `0x${"11".repeat(32)}`;
const MERCHANT_SAFE: `0x${string}` = "0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0";
const REFUND_TO: `0x${string}` = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ROUTER: `0x${string}` = "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a";

const LOCKED_AT = new Date("2026-08-05T10:00:00.000Z");
const DEADLINE = new Date("2026-08-05T10:02:00.500Z");

function lock(overrides: Partial<LockedQuote> = {}): LockedQuote {
  return {
    payerAsset: "ETH",
    settlementAsset: "USDC",
    minOut: money(50_000_000n, "USDC"),
    fee: money(500_000n, "USDC"),
    payerEstimate: { kind: "display-estimate", amount: money(13_600_000_000_000_000n, "ETH") },
    executableRate: 3_700_000_000n,
    executableSource: "0x",
    referenceSource: "pyth",
    slippageBps: 50,
    lockedAt: LOCKED_AT,
    deadline: DEADLINE,
    ...overrides,
  };
}

function context(overrides: Partial<OrderContext> = {}): OrderContext {
  return { intentId: INTENT_ID, merchantSafe: MERCHANT_SAFE, refundTo: REFUND_TO, ...overrides };
}

describe("assembleOrder", () => {
  test("maps the lock and the context onto the router struct", () => {
    const order = assembleOrder(lock(), context(), LOCKED_AT);

    expect(order).toEqual({
      intentId: INTENT_ID,
      minOut: 50_000_000n,
      fee: 500_000n,
      merchantSafe: MERCHANT_SAFE,
      refundTo: REFUND_TO,
      // 2026-08-05T10:02:00.500Z floors to whole seconds.
      deadline: BigInt(Math.floor(DEADLINE.getTime() / 1_000)),
    });
  });

  test("the deadline floors to whole seconds, never past the lock", () => {
    const order = assembleOrder(lock(), context(), LOCKED_AT);

    expect(order.deadline * 1_000n <= BigInt(DEADLINE.getTime())).toBe(true);
  });

  test("a lock at its deadline still assembles — the comparison is inclusive", () => {
    expect(assembleOrder(lock(), context(), DEADLINE).minOut).toBe(50_000_000n);
  });

  test("an expired lock is refused", () => {
    const late = new Date(DEADLINE.getTime() + 1);

    expect(() => assembleOrder(lock(), context(), late)).toThrow(ValidationError);
  });

  test("a malformed intent id is refused", () => {
    expect(() => assembleOrder(lock(), context({ intentId: "0xdeadbeef" }), LOCKED_AT)).toThrow(
      ValidationError,
    );
  });

  test("a malformed merchant Safe address is refused", () => {
    expect(() =>
      assembleOrder(lock(), context({ merchantSafe: "0xnot-an-address" }), LOCKED_AT),
    ).toThrow(ValidationError);
  });

  test("a malformed refund address is refused", () => {
    expect(() => assembleOrder(lock(), context({ refundTo: INTENT_ID }), LOCKED_AT)).toThrow(
      ValidationError,
    );
  });
});

describe("orderTypedData", () => {
  test("carries the frozen domain name and version with the deployment half", () => {
    const order = assembleOrder(lock(), context(), LOCKED_AT);
    const typed = orderTypedData({ chainId: 8_453n, verifyingContract: ROUTER }, order);

    expect(typed.domain).toEqual({
      name: ORDER_DOMAIN_NAME,
      version: ORDER_DOMAIN_VERSION,
      chainId: 8_453n,
      verifyingContract: ROUTER,
    });
    expect(typed.primaryType).toBe("Order");
    expect(typed.message).toEqual(order);
  });

  test("the field list reproduces OrderHash.sol's type string byte-for-byte", () => {
    expect(orderTypeString()).toBe(ORDER_TYPE_STRING);
  });
});

describe("signOrder", () => {
  test("hands the signer the full typed data and pairs order with signature", async () => {
    const signer = new FakeOrderSigner();
    const order = assembleOrder(lock(), context(), LOCKED_AT);

    const signed = await signOrder(signer, { chainId: 8_453n, verifyingContract: ROUTER }, order);

    expect(signed.order).toEqual(order);
    expect(signed.signature).toBe(`0x${"11".repeat(32)}${"00".repeat(32)}1b`);
    expect(signer.calls).toHaveLength(1);
    expect(signer.calls[0]?.domain.verifyingContract).toBe(ROUTER);
    expect(signer.calls[0]?.message.intentId).toBe(INTENT_ID);
  });

  test("the fake signer reports its configured address", async () => {
    const signer = new FakeOrderSigner("0x00000000000000000000000000000000000000b2");

    expect(await signer.address()).toBe("0x00000000000000000000000000000000000000b2");
  });
});
