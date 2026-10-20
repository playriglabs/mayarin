/** AWS KMS-backed EIP-712 signer for production PaymentRouter orders. */

import { KMSClient } from "@aws-sdk/client-kms";
import type { Hex, OrderSigner, OrderTypedData } from "@mayarin/quote";
import { hashTypedData } from "viem";
import { signDigestWithKms } from "./aws-kms-digest.ts";

export interface AwsKmsOrderSignerOptions {
  readonly keyId: string;
  readonly signerAddress: Hex;
  readonly region?: string;
  readonly client?: KMSClient;
}

/** Keeps the secp256k1 private key inside AWS KMS; Railway receives only the signature. */
export class AwsKmsOrderSigner implements OrderSigner {
  readonly #keyId: string;
  readonly #signerAddress: Hex;
  readonly #client: KMSClient;

  constructor(options: AwsKmsOrderSignerOptions) {
    this.#keyId = options.keyId;
    this.#signerAddress = options.signerAddress;
    this.#client =
      options.client ??
      new KMSClient(options.region === undefined ? {} : { region: options.region });
  }

  async address(): Promise<Hex> {
    return this.#signerAddress;
  }

  async sign(typedData: OrderTypedData): Promise<Hex> {
    const signature = await signDigestWithKms({
      client: this.#client,
      keyId: this.#keyId,
      digest: hashTypedData(typedData),
      signerAddress: this.#signerAddress,
    });
    return signature.hex;
  }
}
