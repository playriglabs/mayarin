import { describe, expect, it } from "bun:test";
import { type Eip712Domain, TRANSFER_WITH_AUTHORIZATION_TYPES } from "@mayarin/x402";
import { type Address, type Hex, hashTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  circleChainOf,
  localKeyPayer,
  signatureFrom,
  type TransferAuthorization,
  typedDataFor,
} from "./circle-agent-wallet.ts";

const domain: Eip712Domain = {
  name: "USDC",
  version: "2",
  chainId: 5042002,
  verifyingContract: "0x3600000000000000000000000000000000000000",
};

const authorization: TransferAuthorization = {
  from: "0x1111111111111111111111111111111111111111",
  to: "0x2222222222222222222222222222222222222222",
  value: 20_000n,
  validAfter: 0n,
  validBefore: 1_757_000_000n,
  nonce: `0x${"ab".repeat(32)}`,
};

describe("circleChainOf", () => {
  it("names Arc testnet the way the Circle CLI does", () => {
    expect(circleChainOf("arc-testnet")).toBe("ARC-TESTNET");
  });

  it("refuses a chain the CLI has not been checked for", () => {
    expect(() => circleChainOf("robinhood-testnet")).toThrow(/circle blockchain list/);
  });
});

describe("typedDataFor", () => {
  // The signature is worthless if the CLI hashes a different struct than viem
  // would, and the difference is invisible until a token rejects it. So the
  // assertion is on the digest rather than on the JSON.
  it("hashes to the digest viem produces from the same authorization", () => {
    const parsed = JSON.parse(typedDataFor(domain, authorization));
    expect(hashTypedData(parsed)).toBe(
      hashTypedData({
        domain: { ...domain, verifyingContract: domain.verifyingContract as Address },
        types: TRANSFER_WITH_AUTHORIZATION_TYPES,
        primaryType: "TransferWithAuthorization",
        message: authorization,
      }),
    );
  });

  it("carries every uint256 as a decimal string, since JSON has no bigint", () => {
    const parsed = JSON.parse(typedDataFor(domain, authorization));
    expect(parsed.message.value).toBe("20000");
    expect(parsed.message.validAfter).toBe("0");
    expect(parsed.message.validBefore).toBe("1757000000");
  });
});

describe("signatureFrom", () => {
  const signature = `0x${"cd".repeat(65)}` as Hex;

  it("finds the signature under a banner the CLI shares the stream with", () => {
    expect(signatureFrom(`By using the Circle CLI, you agree to:\n${signature}\n`)).toBe(signature);
  });

  it("refuses output holding a shorter hex value than a signature", () => {
    expect(() => signatureFrom(`0x${"cd".repeat(32)}\n`)).toThrow(/no signature/);
  });
});

describe("localKeyPayer", () => {
  it("signs the same authorization the Circle payload describes", async () => {
    const key = `0x${"11".repeat(32)}` as Hex;
    const payer = localKeyPayer(key);
    expect(payer.custody).toBe("local-key");
    expect(payer.address).toBe(privateKeyToAccount(key).address);
    const signature = await payer.signTransferAuthorization(domain, {
      ...authorization,
      from: payer.address,
    });
    expect(signature).toMatch(/^0x[\da-f]{130}$/);
  });
});
