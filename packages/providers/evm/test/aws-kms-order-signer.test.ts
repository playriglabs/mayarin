import { describe, expect, test } from "bun:test";
import type { KMSClient } from "@aws-sdk/client-kms";
import type { OrderTypedData } from "@mayarin/quote";
import { secp256k1 } from "@noble/curves/secp256k1";
import { hashTypedData, hexToBytes, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AwsKmsOrderSigner } from "../src/aws-kms-order-signer.ts";

const PRIVATE_KEY = `0x${"31".repeat(32)}` as const;
const account = privateKeyToAccount(PRIVATE_KEY);
const typedData: OrderTypedData = {
  domain: {
    name: "Mayarin PaymentRouter" as const,
    version: "1" as const,
    chainId: 8_453n,
    verifyingContract: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a" as const,
  },
  types: {
    Order: [
      { name: "intentId", type: "bytes32" },
      { name: "settlementToken", type: "address" },
      { name: "minOut", type: "uint256" },
      { name: "fee", type: "uint256" },
      { name: "merchantSafe", type: "address" },
      { name: "refundTo", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
  },
  primaryType: "Order" as const,
  message: {
    intentId: `0x${"11".repeat(32)}` as const,
    settlementToken: "0x0000000000000000000000000000000000000001" as const,
    minOut: 1_000_000n,
    fee: 5_000n,
    merchantSafe: "0x0000000000000000000000000000000000000002" as const,
    refundTo: "0x0000000000000000000000000000000000000003" as const,
    deadline: 2_000_000_000n,
  },
};

describe("AwsKmsOrderSigner", () => {
  test("converts the KMS DER signature into an Ethereum-recoverable signature", async () => {
    const digest = hashTypedData(typedData);
    const signature = secp256k1.sign(hexToBytes(digest), hexToBytes(PRIVATE_KEY));
    const client = {
      send: async () => ({ Signature: der(signature.r, signature.s) }),
    } as unknown as KMSClient;
    const signer = new AwsKmsOrderSigner({
      keyId: "alias/mayarin-quote-signer",
      signerAddress: account.address,
      client,
    });

    const ethereumSignature = await signer.sign(typedData);
    const recovered = await recoverTypedDataAddress({ ...typedData, signature: ethereumSignature });

    expect(recovered).toBe(account.address);
  });
});

function der(r: bigint, s: bigint): Uint8Array {
  const integer = (value: bigint): number[] => {
    const hex = value.toString(16).padStart(64, "0");
    const bytes = Array.from(hex.matchAll(/../g), (match) => Number.parseInt(match[0], 16));
    const unsigned = (bytes[0] ?? 0) >= 0x80 ? [0, ...bytes] : bytes;
    return [0x02, unsigned.length, ...unsigned];
  };
  const body = [...integer(r), ...integer(s)];
  return Uint8Array.from([0x30, body.length, ...body]);
}
