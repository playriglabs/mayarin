/**
 * A 32-byte digest signed by an AWS KMS secp256k1 key, as an Ethereum signature.
 *
 * KMS answers with a DER-encoded ECDSA signature and no recovery id, and may return the
 * high `s` that Ethereum refuses. This puts the signature in Ethereum's form and finds the
 * recovery id by recovering the address and comparing it with the one the key is known by,
 * so a key that is not the configured signer fails here instead of on a payment.
 */

import { type KMSClient, SignCommand, type SignCommandOutput } from "@aws-sdk/client-kms";
import { ProviderError } from "@mayarin/shared";
import { type Hex, hexToBytes, recoverAddress } from "viem";

/** KMS errors that no retry changes: the caller is not allowed, or the key cannot sign. */
const PERMANENT_KMS_ERRORS: ReadonlySet<string> = new Set([
  "AccessDeniedException",
  "DisabledException",
  "KeyUnavailableException",
  "KMSInvalidStateException",
  "NotFoundException",
]);

const CURVE_ORDER = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
const HALF_CURVE_ORDER = CURVE_ORDER / 2n;

export interface KmsDigestSignature {
  readonly r: bigint;
  readonly s: bigint;
  /** 0 or 1: the parity a typed transaction carries. */
  readonly yParity: 0 | 1;
  /** `r || s || v` with v 27 or 28: the form a message or typed-data signature takes. */
  readonly hex: Hex;
}

export async function signDigestWithKms(options: {
  readonly client: KMSClient;
  readonly keyId: string;
  readonly digest: Hex;
  readonly signerAddress: Hex;
}): Promise<KmsDigestSignature> {
  const { client, keyId, digest, signerAddress } = options;
  let response: SignCommandOutput;
  try {
    response = await client.send(
      new SignCommand({
        KeyId: keyId,
        Message: hexToBytes(digest),
        MessageType: "DIGEST",
        SigningAlgorithm: "ECDSA_SHA_256",
      }),
    );
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    // A key this process may not use, or one that is disabled or gone, stays that
    // way on the next pass. Retrying it parked a payment forever with the payer's
    // asset already held; failing it says what to fix.
    const permanent =
      cause instanceof Error && PERMANENT_KMS_ERRORS.has((cause as { name?: string }).name ?? "");
    throw new ProviderError(
      permanent ? `AWS KMS refused to sign with key ${keyId}: ${reason}` : "AWS KMS signing failed",
      { cause: reason },
      { cause, retryable: !permanent },
    );
  }

  if (response.Signature === undefined) {
    throw new ProviderError("AWS KMS returned no signature", { keyId });
  }

  const { r, s: rawS } = decodeDerSignature(response.Signature);
  const s = rawS > HALF_CURVE_ORDER ? CURVE_ORDER - rawS : rawS;
  const expected = signerAddress.toLowerCase();

  for (const yParity of [0, 1] as const) {
    const hex = serializeSignature(r, s, (27 + yParity) as 27 | 28);
    const recovered = await recoverAddress({ hash: digest, signature: hex });
    if (recovered.toLowerCase() === expected) return { r, s, yParity, hex };
  }

  throw new ProviderError("AWS KMS signature does not match the configured signer address", {
    signerAddress,
    keyId,
  });
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
