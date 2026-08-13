/** AWS KMS-backed EIP-712 signer for production PaymentRouter orders. */

import { KMSClient, SignCommand, type SignCommandOutput } from "@aws-sdk/client-kms";
import type { Hex, OrderSigner, OrderTypedData } from "@mayarin/quote";
import { ProviderError } from "@mayarin/shared";
import { hashTypedData, hexToBytes, recoverAddress } from "viem";

const CURVE_ORDER = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
const HALF_CURVE_ORDER = CURVE_ORDER / 2n;

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
    const digest = hashTypedData(typedData);
    let response: SignCommandOutput;
    try {
      response = await this.#client.send(
        new SignCommand({
          KeyId: this.#keyId,
          Message: hexToBytes(digest),
          MessageType: "DIGEST",
          SigningAlgorithm: "ECDSA_SHA_256",
        }),
      );
    } catch (cause) {
      throw new ProviderError(
        "AWS KMS signing failed",
        { cause: cause instanceof Error ? cause.message : String(cause) },
        { cause },
      );
    }

    if (response.Signature === undefined) {
      throw new ProviderError("AWS KMS returned no signature", { keyId: this.#keyId });
    }

    const { r, s: rawS } = decodeDerSignature(response.Signature);
    const s = rawS > HALF_CURVE_ORDER ? CURVE_ORDER - rawS : rawS;
    const expected = this.#signerAddress.toLowerCase();

    for (const recovery of [27, 28] as const) {
      const signature = serializeSignature(r, s, recovery);
      const recovered = await recoverAddress({ hash: digest, signature });
      if (recovered.toLowerCase() === expected) return signature;
    }

    throw new ProviderError("AWS KMS signature does not match the configured signer address", {
      signerAddress: this.#signerAddress,
      keyId: this.#keyId,
    });
  }
}

function decodeDerSignature(bytes: Uint8Array): { readonly r: bigint; readonly s: bigint } {
  if (bytes[0] !== 0x30) throw new ProviderError("AWS KMS returned a malformed DER signature");
  let offset = 2;
  if (bytes[1] !== undefined && bytes[1] >= 0x80) offset += bytes[1] & 0x7f;
  const r = readInteger(bytes, offset);
  const s = readInteger(bytes, r.next);
  return { r: r.value, s: s.value };
}

function readInteger(
  bytes: Uint8Array,
  offset: number,
): { readonly value: bigint; readonly next: number } {
  if (bytes[offset] !== 0x02) throw new ProviderError("AWS KMS returned a malformed DER integer");
  const length = bytes[offset + 1];
  if (length === undefined || length === 0 || length >= 0x80) {
    throw new ProviderError("AWS KMS returned an unsupported DER integer length");
  }
  const start = offset + 2;
  const end = start + length;
  if (end > bytes.length) throw new ProviderError("AWS KMS returned a truncated DER signature");
  const hex = Array.from(bytes.slice(start, end), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return { value: BigInt(`0x${hex}`), next: end };
}

function serializeSignature(r: bigint, s: bigint, recovery: 27 | 28): Hex {
  const component = (value: bigint) => value.toString(16).padStart(64, "0");
  return `0x${component(r)}${component(s)}${recovery.toString(16)}`;
}
