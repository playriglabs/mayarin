import { describe, expect, test } from "bun:test";
import { type Order, paymentRouterAbi } from "@mayarin/contracts";
import { ValidationError } from "@mayarin/shared";
import { decodeFunctionData, zeroAddress } from "viem";
import {
  buildPayERC20Call,
  buildPayEthCall,
  encodePermitData,
  type Permit2Single,
  type SwapRoute,
} from "../src/payment-router.ts";

const PAYMENT_ROUTER = "0x00000000000000000000000000000000000c0de5" as const;
const DEX = "0x00000000000000000000000000000000000000d3" as const;
const WETH = "0x000000000000000000000000000000000000e701" as const;

const order: Order = {
  intentId: "0x0000000000000000000000000000000000000000000000000000000000000001",
  minOut: 100_000_000n,
  fee: 1_000_000n,
  merchantSafe: "0x000000000000000000000000000000000000bEEF",
  refundTo: "0x000000000000000000000000000000000000cafE",
  deadline: 57_005n,
};

const signature = `0x${"ab".repeat(65)}` as const;
const permitSignature = `0x${"cd".repeat(65)}` as const;
const route: SwapRoute = { router: DEX, callData: "0xdeadbeef" };

/** viem checksums addresses when it decodes; compare on a single casing. */
function lowerOrder(o: Order): Order {
  return {
    ...o,
    merchantSafe: o.merchantSafe.toLowerCase() as Order["merchantSafe"],
    refundTo: o.refundTo.toLowerCase() as Order["refundTo"],
  };
}

const permit: Permit2Single = {
  token: WETH,
  amount: 1_000_000_000_000_000_000n,
  expiration: 2_000_000_000,
  nonce: 7,
  spender: PAYMENT_ROUTER,
  sigDeadline: 2_000_000_000n,
};

describe("buildPayEthCall", () => {
  test("encodes the call the contract decodes", () => {
    const call = buildPayEthCall({
      paymentRouter: PAYMENT_ROUTER,
      order,
      signature,
      route,
      value: 10n ** 18n,
    });

    expect(call.to).toBe(PAYMENT_ROUTER);
    expect(call.value).toBe(10n ** 18n);

    const decoded = decodeFunctionData({ abi: paymentRouterAbi, data: call.data });
    expect(decoded.functionName).toBe("payEth");
    const args = decoded.args as readonly unknown[];
    expect(lowerOrder(args[0] as Order)).toEqual(lowerOrder(order));
    expect(args[1]).toBe(signature);
    expect(String(args[2]).toLowerCase()).toBe(DEX);
    expect(args[3]).toBe("0xdeadbeef");
  });

  test("rejects a missing route, the way the contract rejects NoRoute", () => {
    expect(() =>
      buildPayEthCall({
        paymentRouter: PAYMENT_ROUTER,
        order,
        signature,
        route: { router: zeroAddress, callData: "0xdeadbeef" },
        value: 1n,
      }),
    ).toThrow(ValidationError);

    expect(() =>
      buildPayEthCall({
        paymentRouter: PAYMENT_ROUTER,
        order,
        signature,
        route: { router: DEX, callData: "0x" },
        value: 1n,
      }),
    ).toThrow(ValidationError);
  });

  test("rejects a zero native value — the contract would have nothing to swap", () => {
    expect(() =>
      buildPayEthCall({ paymentRouter: PAYMENT_ROUTER, order, signature, route, value: 0n }),
    ).toThrow(ValidationError);
  });
});

describe("buildPayERC20Call", () => {
  test("encodes the cross-asset call", () => {
    const call = buildPayERC20Call({
      paymentRouter: PAYMENT_ROUTER,
      order,
      signature,
      permit,
      permitSignature,
      route,
    });

    expect(call.value).toBe(0n);
    const decoded = decodeFunctionData({ abi: paymentRouterAbi, data: call.data });
    expect(decoded.functionName).toBe("payERC20");
    const args = decoded.args as readonly unknown[];
    expect(lowerOrder(args[0] as Order)).toEqual(lowerOrder(order));
    expect(args[1]).toBe(encodePermitData(permit, permitSignature));
    expect(args[2]).toBe(signature);
    expect(String(args[3]).toLowerCase()).toBe(DEX);
  });

  test("same-asset omits the route entirely, matching the contract's no-op path", () => {
    const call = buildPayERC20Call({
      paymentRouter: PAYMENT_ROUTER,
      order,
      signature,
      permit: { ...permit, token: "0x000000000000000000000000000000000000c0de" },
      permitSignature,
    });

    const decoded = decodeFunctionData({ abi: paymentRouterAbi, data: call.data });
    const args = decoded.args as readonly unknown[];
    expect(args[3]).toBe(zeroAddress);
    expect(args[4]).toBe("0x");
  });

  test("rejects a permit whose spender is not the router — Permit2 would reject the pull", () => {
    expect(() =>
      buildPayERC20Call({
        paymentRouter: PAYMENT_ROUTER,
        order,
        signature,
        permit: { ...permit, spender: DEX },
        permitSignature,
        route,
      }),
    ).toThrow(ValidationError);
  });
});

describe("encodePermitData", () => {
  test("packs the PermitSingle tuple the contract abi.decodes", () => {
    // Static layout: head (offset to tuple = 0x40 in the 2-element head is
    // implicit for a static tuple, so the tuple is inline) followed by the
    // dynamic `bytes`. Assert the fields land where the contract reads them.
    const encoded = encodePermitData(permit, permitSignature);
    const words: readonly string[] = encoded.slice(2).match(/.{64}/g) ?? [];
    expect(`0x${String(words[0]).slice(24)}`).toBe(WETH);
    expect(BigInt(`0x${words[1]}`)).toBe(permit.amount);
    expect(Number(BigInt(`0x${words[2]}`))).toBe(permit.expiration);
    expect(Number(BigInt(`0x${words[3]}`))).toBe(permit.nonce);
    expect(`0x${String(words[4]).slice(24)}`).toBe(PAYMENT_ROUTER);
    expect(BigInt(`0x${words[5]}`)).toBe(permit.sigDeadline);
  });
});
