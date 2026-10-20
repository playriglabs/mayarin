/**
 * The operator's signing account, with the key in AWS KMS (SEC-06).
 *
 * The same shape as the Turnkey account: a viem `LocalAccount` that signs transactions and
 * typed data (Permit2) and refuses a message, so the treasury executor, the x402 paths and
 * the nonce reconciler take either without knowing which. The private key is created in
 * KMS as `ECC_SECG_P256K1` / `SIGN_VERIFY` and never leaves it; this process holds only
 * the right to call `kms:Sign` on it.
 *
 * What KMS cannot do is what Turnkey's policy engine does: look inside a transaction and
 * refuse one to a contract that is not ours. The bound on this key is IAM (only the
 * service's role may call `kms:Sign` on it), CloudTrail (every signature is logged), and
 * the float held at the operator address (`OPERATOR_FLOAT_LIMITS`). A process that is
 * compromised can still ask KMS to sign anything while it holds the role.
 */

import { KMSClient } from "@aws-sdk/client-kms";
import { ConfigurationError } from "@mayarin/shared";
import {
  getTypesForEIP712Domain,
  type Hex,
  hashTypedData,
  keccak256,
  type LocalAccount,
  serializeTransaction,
  type TransactionSerializable,
  type TransactionSerialized,
  type TypedData,
  type TypedDataDefinition,
  type TypedDataDomain,
} from "viem";
import { toAccount } from "viem/accounts";
import { signDigestWithKms } from "./aws-kms-digest.ts";

export interface AwsKmsAccountOptions {
  readonly keyId: string;
  /** The address the key's public key derives to (see `scripts/aws-kms-addresses.ts`). */
  readonly signerAddress: Hex;
  readonly region?: string;
  /** For a test; a deployment lets the account build its own from the region. */
  readonly client?: KMSClient;
}

export function createAwsKmsAccount(options: AwsKmsAccountOptions): LocalAccount {
  const { keyId, signerAddress } = options;
  const client =
    options.client ?? new KMSClient(options.region === undefined ? {} : { region: options.region });
  if (keyId === "") throw new ConfigurationError("An AWS KMS key id is required", {});

  const sign = (digest: Hex) => signDigestWithKms({ client, keyId, digest, signerAddress });

  return toAccount({
    address: signerAddress,

    async signMessage(): Promise<Hex> {
      throw new ConfigurationError(
        "The KMS operator account signs transactions and typed data only",
        {
          reason: "a message is a raw payload that nothing can bound",
        },
      );
    },

    async signTypedData<
      const typedData extends TypedData | Record<string, unknown>,
      primaryType extends keyof typedData | "EIP712Domain" = keyof typedData,
    >(typedData: TypedDataDefinition<typedData, primaryType>): Promise<Hex> {
      const { domain } = typedData as { domain?: TypedDataDomain };
      const withDomain = {
        ...typedData,
        types: { EIP712Domain: getTypesForEIP712Domain({ domain }), ...typedData.types },
      } as unknown as Parameters<typeof hashTypedData>[0];
      return (await sign(hashTypedData(withDomain))).hex;
    },

    async signTransaction(transaction, args) {
      const serializer = args?.serializer ?? serializeTransaction;
      // As viem does for a local key: a blob transaction is signed without its sidecars.
      const unsigned: TransactionSerializable =
        transaction.type === "eip4844" ? { ...transaction, sidecars: false } : transaction;
      const { r, s, yParity } = await sign(keccak256((await serializer(unsigned)) as Hex));
      return (await serializer(unsigned, {
        r: `0x${r.toString(16).padStart(64, "0")}`,
        s: `0x${s.toString(16).padStart(64, "0")}`,
        yParity,
      })) as TransactionSerialized;
    },
  });
}
