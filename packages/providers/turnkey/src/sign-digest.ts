/**
 * One signature from a Turnkey-held secp256k1 key (RFC #6 — #41, SEC-06).
 *
 * Turnkey signs opaque bytes: the caller hashes (EIP-712, EIP-191, a transaction)
 * and hands over the 32-byte digest, so what Turnkey sees is minimal and the key
 * never leaves its enclave. Shared by the quote-order signer and the operator
 * account, which differ only in what they hash.
 */

import type { Hex } from "@mayarin/quote";
import { ConfigurationError, ProviderError } from "@mayarin/shared";
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

export interface TurnkeyKeyOptions {
  /** Turnkey organization that owns the signing key. */
  readonly organizationId: string;
  /** The key's Turnkey resource id, or the wallet account address it signs as. */
  readonly signWith: string;
  /** The Ethereum address the key corresponds to. */
  readonly signerAddress: Hex;
  readonly stamper: TurnkeyStamper;
  readonly endpoint?: string;
  /** Injected for tests; defaults to the global `fetch`. */
  readonly fetchFn?: typeof fetch;
}

export function assertTurnkeyKey(options: TurnkeyKeyOptions): void {
  if (options.organizationId.length === 0 || options.signWith.length === 0) {
    throw new ConfigurationError("Turnkey signer needs an organization and a key to sign with", {
      hasOrganizationId: options.organizationId.length > 0,
      hasSignWith: options.signWith.length > 0,
    });
  }
}

const signTransactionResponseSchema = z.object({
  activity: z.object({
    status: z.string(),
    result: z
      .object({
        signTransactionResult: z.object({ signedTransaction: z.string() }).optional(),
      })
      .optional(),
  }),
});

/**
 * Has Turnkey sign an unsigned Ethereum transaction (RLP, as `serializeTransaction`
 * produces it) and returns the signed one.
 *
 * Unlike a raw digest, Turnkey parses a transaction, so its policy engine can
 * test `eth.tx.to`, `eth.tx.chain_id` and `eth.tx.value`. That is the only path
 * by which a policy bounds what a key may send.
 */
export async function signTransaction(options: TurnkeyKeyOptions, unsigned: Hex): Promise<Hex> {
  const body = JSON.stringify({
    type: "ACTIVITY_TYPE_SIGN_TRANSACTION_V2",
    timestampMs: String(Date.now()),
    organizationId: options.organizationId,
    parameters: {
      signWith: options.signWith,
      type: "TRANSACTION_TYPE_ETHEREUM",
      unsignedTransaction: strip(unsigned),
    },
  });
  const response = await post(options, "/public/v1/submit/sign_transaction", body);
  const parsed = signTransactionResponseSchema.safeParse(response);
  if (!parsed.success) {
    throw new ProviderError("Turnkey returned an unreadable sign_transaction response", {
      issues: parsed.error.issues.map((issue) => issue.path.join(".")),
    });
  }
  const signed = parsed.data.activity.result?.signTransactionResult?.signedTransaction;
  if (signed === undefined) {
    // Refused by policy, or waiting on an approval this adapter cannot give.
    throw new ProviderError("Turnkey did not sign the transaction", {
      status: parsed.data.activity.status,
    });
  }
  return `0x${strip(signed)}`;
}

/**
 * Has Turnkey sign EIP-712 typed data it can read.
 *
 * The serialized typed data is sent as is, not its hash: that is the one raw
 * payload mode in which Turnkey's policy engine sees the fields
 * (`eth.eip_712.primary_type`, `domain.verifying_contract`), so a policy can
 * allow a Permit2 permit and nothing else.
 */
export async function signTypedDataPayload(
  options: TurnkeyKeyOptions,
  serialized: string,
): Promise<Hex> {
  return signRaw(options, serialized, "PAYLOAD_ENCODING_EIP712");
}

/** Signs a 32-byte digest; returns the 65-byte `r‖s‖v` with `v` as 27/28. */
export async function signDigest(options: TurnkeyKeyOptions, digest: Hex): Promise<Hex> {
  return signRaw(options, digest, "PAYLOAD_ENCODING_HEXADECIMAL");
}

async function signRaw(
  options: TurnkeyKeyOptions,
  payload: string,
  encoding: "PAYLOAD_ENCODING_HEXADECIMAL" | "PAYLOAD_ENCODING_EIP712",
): Promise<Hex> {
  const body = JSON.stringify({
    type: "ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2",
    timestampMs: String(Date.now()),
    organizationId: options.organizationId,
    parameters: {
      signWith: options.signWith,
      payload,
      // A digest is already the hash its scheme defines, and typed data is hashed
      // by Turnkey as EIP-712 defines: hashing either again would sign the wrong
      // thing.
      encoding,
      hashFunction: "HASH_FUNCTION_NO_OP",
    },
  });

  const response = await post(options, "/public/v1/submit/sign_raw_payload", body);
  const parsed = signRawPayloadResponseSchema.safeParse(response);
  if (!parsed.success) {
    throw new ProviderError("Turnkey returned an unreadable sign_raw_payload response", {
      issues: parsed.error.issues.map((issue) => issue.path.join(".")),
    });
  }

  const result = parsed.data.activity.result?.signRawPayloadResult;
  if (result === undefined) {
    // A pending activity means the key's policy requires an approval this
    // adapter cannot give, or that the policy refused the request outright.
    throw new ProviderError("Turnkey did not return a signature", {
      status: parsed.data.activity.status,
    });
  }

  return assembleSignature(result.r, result.s, result.v);
}

async function post(options: TurnkeyKeyOptions, path: string, body: string): Promise<unknown> {
  const stamp = await options.stamper.stamp(body);
  let response: Response;
  try {
    response = await (options.fetchFn ?? fetch)(
      `${options.endpoint ?? DEFAULT_TURNKEY_ENDPOINT}${path}`,
      { method: "POST", headers: { "Content-Type": "application/json", "X-Stamp": stamp }, body },
    );
  } catch (cause) {
    throw new ProviderError("Turnkey request failed", {
      path,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
  if (!response.ok) {
    throw new ProviderError("Turnkey rejected the request", { path, status: response.status });
  }
  return response.json();
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
