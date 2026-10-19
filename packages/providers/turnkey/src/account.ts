/**
 * A viem account whose key lives in Turnkey (SEC-06).
 *
 * The operator key signs treasury sweeps, x402 settlements and swaps, so a raw
 * key in a service's environment means anyone who can read the process can empty
 * the treasury. Here the key stays in Turnkey's enclave and its policy engine
 * decides what it may sign; this account only builds the request. A drop-in for
 * `privateKeyToAccount` where the operator is used: transactions and typed data.
 *
 * What it deliberately does not do is sign a bare digest or a message. Turnkey
 * cannot read a digest, so a policy cannot bound it, and a key allowed to sign
 * arbitrary digests can sign any transaction hash: it would bypass every rule in
 * `policies.ts`. Transactions go through `sign_transaction` and typed data
 * through the EIP-712 payload mode, the two requests Turnkey parses.
 *
 * A request the policy refuses surfaces as the `ProviderError` from the signing
 * call, never as a signature.
 */

import { ConfigurationError } from "@mayarin/shared";
import {
  getTypesForEIP712Domain,
  type Hex,
  type LocalAccount,
  serializeTransaction,
  serializeTypedData,
  type TransactionSerializable,
  type TransactionSerialized,
  type TypedData,
  type TypedDataDefinition,
  type TypedDataDomain,
} from "viem";
import { toAccount } from "viem/accounts";
import {
  assertTurnkeyKey,
  signTransaction,
  signTypedDataPayload,
  type TurnkeyKeyOptions,
} from "./sign-digest.ts";

export function createTurnkeyAccount(options: TurnkeyKeyOptions): LocalAccount {
  assertTurnkeyKey(options);

  return toAccount({
    address: options.signerAddress,

    async signMessage(): Promise<Hex> {
      throw new ConfigurationError(
        "The Turnkey operator account signs transactions and typed data only",
        { reason: "a message is a raw payload, which no policy can bound" },
      );
    },

    async signTypedData<
      const typedData extends TypedData | Record<string, unknown>,
      primaryType extends keyof typedData | "EIP712Domain" = keyof typedData,
    >(typedData: TypedDataDefinition<typedData, primaryType>): Promise<Hex> {
      // The domain is serialized only against an `EIP712Domain` type; without it
      // the payload goes out with an empty domain, which no policy could match.
      const { domain } = typedData as { domain?: TypedDataDomain };
      const withDomain = {
        ...typedData,
        types: { EIP712Domain: getTypesForEIP712Domain({ domain }), ...typedData.types },
      } as unknown as Parameters<typeof serializeTypedData>[0];
      return signTypedDataPayload(options, serializeTypedData(withDomain));
    },

    async signTransaction(transaction, args) {
      const serializer = args?.serializer ?? serializeTransaction;
      // As viem does for a local key: a blob transaction is signed without its
      // sidecars.
      const unsigned: TransactionSerializable =
        transaction.type === "eip4844" ? { ...transaction, sidecars: false } : transaction;
      return (await signTransaction(options, serializer(unsigned) as Hex)) as TransactionSerialized;
    },
  });
}
