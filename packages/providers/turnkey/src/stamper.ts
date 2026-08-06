/**
 * Turnkey request stamping (RFC #6 — #41).
 *
 * Turnkey does not authenticate with a bearer token. Every request body is
 * signed with an API key, and the signature travels in an `X-Stamp` header —
 * so a stolen header cannot be replayed against a different body. That signing
 * is the one piece of real cryptography in this adapter, so it sits behind its
 * own seam: the HTTP adapter takes a `TurnkeyStamper`, and tests pass a fake
 * instead of embedding key material in a fixture.
 *
 * The API key is P-256, and is a *different* key from the secp256k1 key Turnkey
 * holds for signing orders. This one authenticates the caller; that one signs
 * the payload and never leaves Turnkey's enclave.
 */

import { ConfigurationError } from "@mayarin/shared";
import { p256 } from "@noble/curves/nist";

/** Signs a request body, returning the value of the `X-Stamp` header. */
export interface TurnkeyStamper {
  stamp(body: string): Promise<string>;
}

/** The stamp envelope Turnkey base64url-decodes out of the header. */
interface StampEnvelope {
  readonly publicKey: string;
  readonly scheme: "SIGNATURE_SCHEME_TK_API_P256";
  readonly signature: string;
}

export interface ApiKeyStamperOptions {
  /** Turnkey API public key, compressed P-256, hex. */
  readonly apiPublicKey: string;
  /** Turnkey API private key, hex. Never logged, never leaves this object. */
  readonly apiPrivateKey: string;
}

/**
 * The production stamper: P-256 ECDSA over the request body, DER-encoded, in a
 * base64url envelope.
 *
 * `@noble/curves` produces a low-S signature by default, which is what Turnkey
 * expects; DER is the encoding it parses.
 */
export class ApiKeyStamper implements TurnkeyStamper {
  readonly #publicKey: string;
  readonly #privateKey: string;

  constructor(options: ApiKeyStamperOptions) {
    if (options.apiPublicKey.length === 0 || options.apiPrivateKey.length === 0) {
      throw new ConfigurationError("Turnkey API key pair must be non-empty", {
        hasPublicKey: options.apiPublicKey.length > 0,
      });
    }
    this.#publicKey = options.apiPublicKey;
    this.#privateKey = options.apiPrivateKey;
  }

  async stamp(body: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
    const signature = p256.sign(new Uint8Array(digest), hexToBytes(this.#privateKey), {
      prehash: false,
    });
    const envelope: StampEnvelope = {
      publicKey: this.#publicKey,
      scheme: "SIGNATURE_SCHEME_TK_API_P256",
      signature: bytesToHex(signature.toDERRawBytes()),
    };
    return base64UrlEncode(JSON.stringify(envelope));
  }
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** base64url, per the stamp envelope: no padding, `-` and `_` for `+` and `/`. */
function base64UrlEncode(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
