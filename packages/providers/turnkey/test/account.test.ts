import { describe, expect, test } from "bun:test";
import {
  type Hex,
  hashTypedData,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  recoverTypedDataAddress,
  serializeTransaction,
  type TransactionSerializable,
  type TransactionSerialized,
} from "viem";
import { generatePrivateKey, privateKeyToAccount, sign } from "viem/accounts";
import { createTurnkeyAccount } from "../src/account.ts";

interface Seen {
  readonly path: string;
  readonly type: string;
  readonly parameters: Record<string, string>;
}

/**
 * A Turnkey stand-in holding a real key. It answers `sign_transaction` with the
 * signed RLP (no `0x`, as the API does) and `sign_raw_payload` with an EIP-712
 * payload by hashing the typed data it was sent, and records every request so a
 * test can see what Turnkey was asked to sign.
 */
function fakeTurnkey(privateKey: Hex, behaviour: "sign" | "refuse" = "sign") {
  const seen: Seen[] = [];
  const fetchFn = (async (url: string, init: { body: string }) => {
    const request = JSON.parse(init.body);
    seen.push({ path: new URL(url).pathname, type: request.type, parameters: request.parameters });
    if (behaviour === "refuse") {
      return new Response(JSON.stringify({ activity: { status: "ACTIVITY_STATUS_FAILED" } }));
    }

    if (request.type === "ACTIVITY_TYPE_SIGN_TRANSACTION_V2") {
      const unsigned = `0x${request.parameters.unsignedTransaction}` as TransactionSerialized;
      const signature = await sign({ hash: keccak256(unsigned), privateKey });
      const transaction = parseTransaction(unsigned) as TransactionSerializable;
      const signed = serializeTransaction(transaction, signature);
      return new Response(
        JSON.stringify({
          activity: {
            status: "ACTIVITY_STATUS_COMPLETED",
            result: { signTransactionResult: { signedTransaction: signed.slice(2) } },
          },
        }),
      );
    }

    const typed = JSON.parse(request.parameters.payload);
    const { EIP712Domain: _domain, ...types } = typed.types;
    const hash = hashTypedData({
      domain: { ...typed.domain, chainId: BigInt(typed.domain.chainId) },
      types,
      primaryType: typed.primaryType,
      message: { ...typed.message, amount: BigInt(typed.message.amount) },
    });
    const signature = await sign({ hash, privateKey });
    return new Response(
      JSON.stringify({
        activity: {
          status: "ACTIVITY_STATUS_COMPLETED",
          result: {
            signRawPayloadResult: {
              r: signature.r.slice(2),
              s: signature.s.slice(2),
              v: signature.yParity === 0 ? "00" : "01",
            },
          },
        },
      }),
    );
  }) as unknown as typeof fetch;
  return { fetchFn, seen };
}

const privateKey = generatePrivateKey();
const local = privateKeyToAccount(privateKey);

function turnkeyAccount(behaviour: "sign" | "refuse" = "sign") {
  const turnkey = fakeTurnkey(privateKey, behaviour);
  const account = createTurnkeyAccount({
    organizationId: "org_1",
    signWith: local.address,
    signerAddress: local.address,
    stamper: { stamp: async () => "stamp" },
    fetchFn: turnkey.fetchFn,
  });
  return { account, ...turnkey };
}

const eip1559: TransactionSerializable = {
  type: "eip1559",
  chainId: 84532,
  nonce: 7,
  to: "0x00000000000000000000000000000000000000aa",
  value: 5n,
  data: "0xa9059cbb",
  gas: 60_000n,
  maxFeePerGas: 2_000_000_000n,
  maxPriorityFeePerGas: 1_000_000_000n,
};

const typedData = {
  domain: { name: "Permit2", chainId: 84532, verifyingContract: local.address },
  types: { Permit: [{ name: "amount", type: "uint256" }] },
  primaryType: "Permit",
  message: { amount: 10n },
} as const;

describe("createTurnkeyAccount", () => {
  test("is the key's address, and a local-style account viem can drive", () => {
    const { account } = turnkeyAccount();
    expect(account.address).toBe(local.address);
    expect(account.type).toBe("local");
  });

  test("a transaction goes to Turnkey as an unsigned transaction it can parse, and comes back signed", async () => {
    const { account, seen } = turnkeyAccount();
    const signed = await account.signTransaction(eip1559);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      path: "/public/v1/submit/sign_transaction",
      type: "ACTIVITY_TYPE_SIGN_TRANSACTION_V2",
      parameters: { signWith: local.address, type: "TRANSACTION_TYPE_ETHEREUM" },
    });
    // Unsigned, so Turnkey's policy engine reads `to`, `chain_id` and `value`.
    expect(`0x${seen[0]?.parameters.unsignedTransaction}`).toBe(serializeTransaction(eip1559));

    expect(signed).toBe(await local.signTransaction(eip1559));
    expect(
      await recoverTransactionAddress({ serializedTransaction: signed as TransactionSerialized }),
    ).toBe(local.address);
  });

  test("a legacy transaction and a replacement with higher fees both sign", async () => {
    const { account } = turnkeyAccount();
    const legacy: TransactionSerializable = {
      type: "legacy",
      chainId: 1,
      nonce: 1,
      to: eip1559.to,
      value: 1n,
      gas: 21_000n,
      gasPrice: 1_000_000_000n,
    };
    expect(await account.signTransaction(legacy)).toBe(await local.signTransaction(legacy));

    const bumped = {
      ...eip1559,
      maxFeePerGas: 2_250_000_001n,
      maxPriorityFeePerGas: 1_125_000_001n,
    };
    expect(
      await recoverTransactionAddress({
        serializedTransaction: (await account.signTransaction(bumped)) as TransactionSerialized,
      }),
    ).toBe(local.address);
  });

  test("typed data goes as EIP-712 the policy engine can read, never as a digest", async () => {
    const { account, seen } = turnkeyAccount();
    const signature = await account.signTypedData(typedData);

    expect(seen[0]).toMatchObject({
      path: "/public/v1/submit/sign_raw_payload",
      parameters: { encoding: "PAYLOAD_ENCODING_EIP712", signWith: local.address },
    });
    const sent = JSON.parse(seen[0]?.parameters.payload ?? "{}");
    expect(sent.primaryType).toBe("Permit");
    // Lowercase, which is how a policy must write an address to match it.
    expect(sent.domain).toMatchObject({
      name: "Permit2",
      verifyingContract: local.address.toLowerCase(),
    });
    expect(sent.types.EIP712Domain.map((field: { name: string }) => field.name)).toEqual([
      "name",
      "chainId",
      "verifyingContract",
    ]);

    expect(signature).toBe(await local.signTypedData(typedData));
    expect(await recoverTypedDataAddress({ ...typedData, signature })).toBe(local.address);
  });

  test("a bare message is refused here, because a policy could not bound it", async () => {
    const { account, seen } = turnkeyAccount();
    await expect(account.signMessage({ message: "mayarin" })).rejects.toThrow(
      "transactions and typed data",
    );
    expect(seen).toHaveLength(0);
  });

  test("a refusal by the policy is an error, never a signature", async () => {
    const { account } = turnkeyAccount("refuse");
    await expect(account.signTransaction(eip1559)).rejects.toThrow("did not sign");
    await expect(account.signTypedData(typedData)).rejects.toThrow("did not return a signature");
  });

  test("needs an organization and a key", () => {
    expect(() =>
      createTurnkeyAccount({
        organizationId: "",
        signWith: "k",
        signerAddress: local.address,
        stamper: { stamp: async () => "s" },
      }),
    ).toThrow("organization");
  });
});
