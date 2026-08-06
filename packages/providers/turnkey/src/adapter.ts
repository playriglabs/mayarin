/**
 * Turnkey order signer (RFC #6 — #41).
 *
 * Implements the `OrderSigner` port over Turnkey's `sign_raw_payload`. The
 * quote-signing key is a custody-adjacent trust root — whoever holds it can
 * authorize settlement amounts — so it lives in Turnkey's enclave and is never
 * exported. This adapter hands Turnkey a 32-byte EIP-712 digest and gets back
 * `r`, `s`, `v`.
 *
 * Turnkey was chosen over AWS KMS and a dedicated HSM because the roadmap
 * already names it for wallet infrastructure (RFC #11, #20), so one custody
 * vendor covers both, and because its managed rotation pairs with the
 * contract's timelocked `setSigner`. The rationale and the rotation runbook are
 * in `docs/quote-signing.md`.
 *
 * The digest is computed here rather than sent as a struct: Turnkey signs
 * opaque bytes, and EIP-712 hashing is the quote package's business. That also
 * keeps what Turnkey sees minimal — it never learns the order's contents.
 */

import type { Hex, OrderSigner, OrderTypedData } from "@mayarin/quote";
import { ConfigurationError, ProviderError } from "@mayarin/shared";
import { hashTypedData } from "viem";
import { z } from "zod";
import type { TurnkeyStamper } from "./stamper.ts";

export const DEFAULT_TURNKEY_ENDPOINT = "https://api.turnkey.com";

/**
 * The slice of the `sign_raw_payload` result this adapter reads. Turnkey wraps
 * activity results deeply; anything not modelled here is ignored rather than
 * rejected, so a Turnkey-side addition does not break signing.
 */
const signRawPayloadResponseSchema = z.object({
  activity: z.object({
    status: z.string(),
    result: z
      .object({
        signRawPayloadResult: z
          .object({
            r: z.string(),
            s: z.string(),
            v: z.string(),
          })
          .optional(),
      })
      .optional(),
  }),
});

export interface TurnkeyOrderSignerOptions {
  /** Turnkey organization that owns the signing key. */
  readonly organizationId: string;
  /** The key's Turnkey resource id, or the wallet account address it signs as. */
  readonly signWith: string;
  /**
   * The Ethereum address the key corresponds to. The contract's `signer` role
   * must equal this, and rotation means changing both — Turnkey side and, via
   * the timelock, on-chain.
   */
  readonly signerAddress: Hex;
  readonly stamper: TurnkeyStamper;
  readonly endpoint?: string;
  /** Injected for tests; defaults to the global `fetch`. */
  readonly fetchFn?: typeof fetch;
}

export class TurnkeyOrderSigner implements OrderSigner {
  readonly #organizationId: string;
  readonly #signWith: string;
  readonly #signerAddress: Hex;
  readonly #stamper: TurnkeyStamper;
  readonly #endpoint: string;
  readonly #fetchFn: typeof fetch;

  constructor(options: TurnkeyOrderSignerOptions) {
    if (options.organizationId.length === 0 || options.signWith.length === 0) {
      throw new ConfigurationError("Turnkey signer needs an organization and a key to sign with", {
        hasOrganizationId: options.organizationId.length > 0,
        hasSignWith: options.signWith.length > 0,
      });
    }
    this.#organizationId = options.organizationId;
    this.#signWith = options.signWith;
    this.#signerAddress = options.signerAddress;
    this.#stamper = options.stamper;
    this.#endpoint = options.endpoint ?? DEFAULT_TURNKEY_ENDPOINT;
    this.#fetchFn = options.fetchFn ?? fetch;
  }

  async address(): Promise<Hex> {
    return this.#signerAddress;
  }

  async sign(typedData: OrderTypedData): Promise<Hex> {
    const digest = hashTypedData(typedData);
    const body = JSON.stringify({
      type: "ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2",
      timestampMs: String(Date.now()),
      organizationId: this.#organizationId,
      parameters: {
        signWith: this.#signWith,
        payload: digest,
        // The digest is already the hash EIP-712 defines; hashing it again
        // would sign the wrong thing.
        encoding: "PAYLOAD_ENCODING_HEXADECIMAL",
        hashFunction: "HASH_FUNCTION_NO_OP",
      },
    });

    const response = await this.#post("/public/v1/submit/sign_raw_payload", body);
    const parsed = signRawPayloadResponseSchema.safeParse(response);
    if (!parsed.success) {
      throw new ProviderError("Turnkey returned an unreadable sign_raw_payload response", {
        issues: parsed.error.issues.map((issue) => issue.path.join(".")),
      });
    }

    const result = parsed.data.activity.result?.signRawPayloadResult;
    if (result === undefined) {
      // A pending activity means the key's policy requires an approval this
      // adapter cannot give. Retryable: the caller may re-quote once the policy
      // is satisfied, and the lock TTL bounds how long that is worth doing.
      throw new ProviderError("Turnkey did not return a signature", {
        status: parsed.data.activity.status,
      });
    }

    return assembleSignature(result.r, result.s, result.v);
  }

  async #post(path: string, body: string): Promise<unknown> {
    const stamp = await this.#stamper.stamp(body);
    let response: Response;
    try {
      response = await this.#fetchFn(`${this.#endpoint}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Stamp": stamp },
        body,
      });
    } catch (cause) {
      throw new ProviderError("Turnkey request failed", {
        path,
        cause: cause instanceof Error ? cause.message : String(cause),
      });
    }
    if (!response.ok) {
      throw new ProviderError("Turnkey rejected the request", {
        path,
        status: response.status,
      });
    }
    return response.json();
  }
}

/**
 * Packs Turnkey's `r`/`s`/`v` into the 65-byte `r‖s‖v` the contract's
 * `ECDSA.recover` expects.
 *
 * Turnkey returns `v` as a recovery id (`"00"`/`"01"`), while Ethereum wants
 * 27/28. Passing the recovery id through unchanged produces a signature that
 * recovers to a different address — which on-chain looks exactly like a wrong
 * signer, so it is worth being explicit about.
 */
export function assembleSignature(r: string, s: string, v: string): Hex {
  const rHex = strip(r).padStart(64, "0");
  const sHex = strip(s).padStart(64, "0");
  const recovery = Number.parseInt(strip(v), 16);
  if (Number.isNaN(recovery)) {
    throw new ProviderError("Turnkey returned a non-numeric recovery id", { v });
  }
  const yParity = recovery >= 27 ? recovery : recovery + 27;
  if (yParity !== 27 && yParity !== 28) {
    throw new ProviderError("Turnkey returned an out-of-range recovery id", { v });
  }
  return `0x${rHex}${sHex}${yParity.toString(16)}`;
}

function strip(value: string): string {
  return value.startsWith("0x") ? value.slice(2) : value;
}
