/**
 * The TS half of the #24 order-hash round-trip.
 *
 * `vectors/order-hash.json` is the single committed source; this suite re-derives
 * every value in it from what `@mayarin/quote` declares, and
 * `PaymentRouter.t.sol` re-derives the same values from what the contract
 * computes. A drift between the quote engine's field list and the contract's
 * typehash — the failure mode that would otherwise surface as signatures
 * mysteriously failing verification on-chain — breaks one of the two suites here
 * instead.
 */

import { describe, expect, test } from "bun:test";
import {
  ORDER_DOMAIN_NAME,
  ORDER_DOMAIN_VERSION,
  ORDER_TYPE_STRING,
  ORDER_TYPES,
  orderTypedData,
  orderTypeString,
} from "@mayarin/quote";
import { hashDomain, hashStruct, hashTypedData, keccak256, toHex } from "viem";
import vectors from "../vectors/order-hash.json" with { type: "json" };

const domain = {
  name: ORDER_DOMAIN_NAME,
  version: ORDER_DOMAIN_VERSION,
  chainId: BigInt(vectors.domain.chainId),
  verifyingContract: vectors.domain.verifyingContract as `0x${string}`,
} as const;

const order = {
  intentId: vectors.order.intentId as `0x${string}`,
  settlementToken: vectors.order.settlementToken as `0x${string}`,
  minOut: BigInt(vectors.order.minOut),
  fee: BigInt(vectors.order.fee),
  merchantSafe: vectors.order.merchantSafe as `0x${string}`,
  refundTo: vectors.order.refundTo as `0x${string}`,
  deadline: BigInt(vectors.order.deadline),
} as const;

describe("order hash vectors", () => {
  test("the vector domain is the one the quote package declares", () => {
    expect(vectors.domain.name).toBe(ORDER_DOMAIN_NAME);
    expect(vectors.domain.version).toBe(ORDER_DOMAIN_VERSION);
  });

  test("the type string matches the field list, in order", () => {
    expect(orderTypeString()).toBe(ORDER_TYPE_STRING);
    expect(vectors.typeString).toBe(ORDER_TYPE_STRING);
  });

  test("the typehash is the keccak of that type string", () => {
    expect(keccak256(toHex(ORDER_TYPE_STRING))).toBe(vectors.typeHash as `0x${string}`);
  });

  test("the domain separator reproduces", () => {
    const separator = hashDomain({
      domain,
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
      },
    });
    expect(separator).toBe(vectors.domainSeparator as `0x${string}`);
  });

  test("the struct hash reproduces from ORDER_TYPES", () => {
    const structHash = hashStruct({ data: order, primaryType: "Order", types: ORDER_TYPES });
    expect(structHash).toBe(vectors.structHash as `0x${string}`);
  });

  test("the digest reproduces from the payload orderTypedData builds", () => {
    const typedData = orderTypedData(
      { chainId: domain.chainId, verifyingContract: domain.verifyingContract },
      order,
    );
    expect(hashTypedData(typedData)).toBe(vectors.digest as `0x${string}`);
  });

  test("a changed field breaks the digest", () => {
    const tampered = hashTypedData(
      orderTypedData(
        { chainId: domain.chainId, verifyingContract: domain.verifyingContract },
        { ...order, minOut: order.minOut + 1n },
      ),
    );
    expect(tampered).not.toBe(vectors.digest as `0x${string}`);
  });
});
