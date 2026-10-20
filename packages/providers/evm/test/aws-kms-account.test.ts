import { describe, expect, test } from "bun:test";
import type { KMSClient } from "@aws-sdk/client-kms";
import { secp256k1 } from "@noble/curves/secp256k1";
import {
  type Hex,
  hashTypedData,
  hexToBytes,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  recoverTypedDataAddress,
  serializeTransaction,
  type TransactionSerialized,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createAwsKmsAccount } from "../src/aws-kms-account.ts";

const PRIVATE_KEY = `0x${"42".repeat(32)}` as const;
const key = privateKeyToAccount(PRIVATE_KEY);

/** A KMS that holds one key and answers `Sign` the way KMS does: DER, no recovery id, either `s`. */
function fakeKms(highS = false): KMSClient {
  return {
    send: async (command: { input: { Message: Uint8Array } }) => {
      const signature = secp256k1.sign(command.input.Message, hexToBytes(PRIVATE_KEY));
      const s = highS
        ? BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141") - signature.s
        : signature.s;
      return { Signature: der(signature.r, s) };
    },
  } as unknown as KMSClient;
}

describe("createAwsKmsAccount", () => {
  const permit = {
    domain: {
      name: "Permit2",
      chainId: 8_453n,
      verifyingContract: "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const,
    },
    types: {
      PermitSingle: [
        { name: "spender", type: "address" },
        { name: "sigDeadline", type: "uint256" },
      ],
    },
    primaryType: "PermitSingle" as const,
    message: {
      spender: "0x0000000000000000000000000000000000000002" as const,
      sigDeadline: 2_000_000_000n,
    },
  };

  test("signs an EIP-1559 transaction that recovers to the operator", async () => {
    const account = createAwsKmsAccount({
      keyId: "alias/op",
      signerAddress: key.address,
      client: fakeKms(),
    });
    const unsigned = {
      type: "eip1559" as const,
      chainId: 8_453,
      nonce: 7,
      to: "0x0000000000000000000000000000000000000009" as const,
      value: 0n,
      data: "0xdeadbeef" as Hex,
      gas: 120_000n,
      maxFeePerGas: 1_000_000n,
      maxPriorityFeePerGas: 1_000n,
    };
    const raw = await account.signTransaction(unsigned);

    expect(
      await recoverTransactionAddress({ serializedTransaction: raw as TransactionSerialized }),
    ).toBe(key.address);
    expect(parseTransaction(raw).nonce).toBe(7);
    // The same transaction signed by the plain local key, byte for byte.
    expect(raw).toBe(await key.signTransaction(unsigned));
  });

  test("signs typed data (Permit2) that recovers to the operator", async () => {
    const account = createAwsKmsAccount({
      keyId: "alias/op",
      signerAddress: key.address,
      client: fakeKms(),
    });
    const signature = await account.signTypedData(permit);
    expect(await recoverTypedDataAddress({ ...permit, signature })).toBe(key.address);
    expect(signature).toBe(await key.signTypedData(permit));
  });

  test("a high-s answer from KMS is normalised, not refused", async () => {
    const account = createAwsKmsAccount({
      keyId: "alias/op",
      signerAddress: key.address,
      client: fakeKms(true),
    });
    const signature = await account.signTypedData(permit);
    expect(await recoverTypedDataAddress({ ...permit, signature })).toBe(key.address);
  });

  test("a key that is not the configured operator is refused, not used", async () => {
    const other = privateKeyToAccount(`0x${"07".repeat(32)}`);
    const account = createAwsKmsAccount({
      keyId: "alias/op",
      signerAddress: other.address,
      client: fakeKms(),
    });
    await expect(account.signTypedData(permit)).rejects.toThrow("does not match");
    await expect(
      account.signTransaction({
        type: "eip1559",
        chainId: 1,
        nonce: 0,
        to: other.address,
        gas: 21_000n,
        maxFeePerGas: 1n,
        maxPriorityFeePerGas: 1n,
      }),
    ).rejects.toThrow("does not match");
  });

  test("refuses a raw message: nothing can bound it", async () => {
    const account = createAwsKmsAccount({
      keyId: "alias/op",
      signerAddress: key.address,
      client: fakeKms(),
    });
    await expect(account.signMessage({ message: "hello" })).rejects.toThrow(
      "transactions and typed data only",
    );
  });

  test("hashes what it signs: the digest KMS sees is the transaction's keccak", async () => {
    let seen: Uint8Array | undefined;
    const spy = {
      send: async (command: { input: { Message: Uint8Array } }) => {
        seen = command.input.Message;
        const signature = secp256k1.sign(seen, hexToBytes(PRIVATE_KEY));
        return { Signature: der(signature.r, signature.s) };
      },
    } as unknown as KMSClient;
    const account = createAwsKmsAccount({
      keyId: "alias/op",
      signerAddress: key.address,
      client: spy,
    });
    const unsigned = {
      type: "eip1559" as const,
      chainId: 1,
      nonce: 1,
      to: key.address,
      gas: 21_000n,
      maxFeePerGas: 1n,
      maxPriorityFeePerGas: 1n,
    };
    await account.signTransaction(unsigned);
    expect(`0x${Buffer.from(seen ?? []).toString("hex")}`).toBe(
      keccak256(serializeTransaction(unsigned)),
    );
    expect(hashTypedData(permit)).toBeDefined();
  });
});

function der(r: bigint, s: bigint): Uint8Array {
  const integer = (value: bigint) => {
    let hex = value.toString(16);
    if (hex.length % 2 === 1) hex = `0${hex}`;
    let bytes = Array.from(hexToBytes(`0x${hex}`));
    if ((bytes[0] ?? 0) >= 0x80) bytes = [0, ...bytes];
    return [0x02, bytes.length, ...bytes];
  };
  const body = [...integer(r), ...integer(s)];
  return Uint8Array.from([0x30, body.length, ...body]);
}
