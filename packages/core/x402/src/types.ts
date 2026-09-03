/**
 * x402 protocol v2 wire types.
 *
 * Field names are the specification's, verbatim — `x402Version`, `accepts`,
 * `payTo`, `maxTimeoutSeconds`, `accepted`, `isValid`, `invalidReason`. They do
 * not follow this codebase's naming because they are not this codebase's names:
 * a payer's client builds these objects, and a rename here is a payment that
 * fails to parse. Anything Mayarin-shaped stays outside this file.
 *
 * Two conventions carry through every type below:
 *
 * - `amount` and the authorization's `value` are **strings of atomic units**.
 *   The wire carries a decimal string because JSON has no integers wide enough
 *   for an 18-decimal balance; the domain carries a `Money`. `amount.ts` is the
 *   only place that crosses between them.
 * - `network` is CAIP-2 (`eip155:84532`), not a `ChainId`. `@mayarin/chain`
 *   owns the mapping.
 *
 * Spec: https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md
 */

/** The only protocol version this implementation speaks. */
export const X402_VERSION = 2;

/**
 * How the payer's funds actually move, from the `exact` scheme's three methods.
 *
 * The choice is a property of the token, not of the deployment: a token with
 * EIP-3009 uses `eip3009`, and anything else falls to `permit2`, which works
 * for any ERC-20 at the cost of a one-time approval. `erc7710` is named here
 * because the scheme defines it, and is not implemented.
 *
 * Which one a `(chain, asset)` pair advertises is decided by asking the
 * contract, never by configuration — see `AssetTransferCapability`.
 */
export const ASSET_TRANSFER_METHODS = ["eip3009", "permit2", "erc7710"] as const;

export type AssetTransferMethod = (typeof ASSET_TRANSFER_METHODS)[number];

export function isAssetTransferMethod(value: unknown): value is AssetTransferMethod {
  return typeof value === "string" && (ASSET_TRANSFER_METHODS as readonly string[]).includes(value);
}

/** The resource a payment buys. */
export interface ResourceInfo {
  readonly url: string;
  readonly description?: string;
  readonly mimeType?: string;
}

/**
 * One way to pay for a resource. A `PaymentRequired` may offer several — the
 * same price on two chains, or two assets on one — and the payer picks.
 */
export interface PaymentRequirements {
  readonly scheme: string;
  /** CAIP-2, e.g. `eip155:84532`. */
  readonly network: string;
  /** Atomic units, as a decimal string. */
  readonly amount: string;
  /** ERC-20 contract address. */
  readonly asset: string;
  /** Recipient address. */
  readonly payTo: string;
  readonly maxTimeoutSeconds: number;
  /**
   * Scheme-specific data. For `exact` on EVM this carries the token's EIP-712
   * domain (`name`, `version`) and, when Mayarin states one, the
   * `assetTransferMethod`.
   */
  readonly extra?: Readonly<Record<string, unknown>>;
}

/** What a resource server returns when a request arrives unpaid. */
export interface PaymentRequired {
  readonly x402Version: number;
  readonly error?: string;
  readonly resource: ResourceInfo;
  readonly accepts: readonly PaymentRequirements[];
  readonly extensions?: Readonly<Record<string, unknown>>;
}

/**
 * EIP-3009 `TransferWithAuthorization` parameters.
 *
 * Every numeric field is a string for the same reason `amount` is: `value` is a
 * `uint256`, and the timestamps travel as strings in the specification's own
 * examples. Parsing them is `amount.ts`'s job, not JSON's.
 */
export interface Authorization {
  readonly from: string;
  readonly to: string;
  readonly value: string;
  readonly validAfter: string;
  readonly validBefore: string;
  /** 32 bytes, `0x`-prefixed. */
  readonly nonce: string;
}

/** The `payload` of an `exact` payment settled through EIP-3009. */
export interface Eip3009Payload {
  readonly signature: string;
  readonly authorization: Authorization;
}

/** What the payer sends back, having signed. */
export interface PaymentPayload {
  readonly x402Version: number;
  readonly resource?: ResourceInfo;
  /** The `PaymentRequirements` the payer chose from `accepts`. */
  readonly accepted: PaymentRequirements;
  /** Scheme-specific. `Eip3009Payload` for `exact` over EIP-3009. */
  readonly payload: Readonly<Record<string, unknown>>;
  readonly extensions?: Readonly<Record<string, unknown>>;
}

/** A facilitator's answer to "would this payment go through?". */
export interface VerifyResponse {
  readonly isValid: boolean;
  readonly invalidReason?: string;
  readonly payer?: string;
}

/** A facilitator's answer to "did this payment go through?". */
export interface SettleResponse {
  readonly success: boolean;
  readonly errorReason?: string;
  readonly payer?: string;
  /** Transaction hash; the empty string when settlement failed. */
  readonly transaction: string;
  readonly network: string;
  readonly amount?: string;
  readonly extensions?: Readonly<Record<string, unknown>>;
}

/**
 * The reasons a verification can fail.
 *
 * A closed set rather than free text, because `invalidReason` is the only thing
 * a payer's client can branch on, and because these map onto the failure
 * taxonomy: a payer who signed for the wrong amount should retry with a new
 * signature, while one whose balance is short should not.
 *
 * `PERMIT2_ALLOWANCE_REQUIRED` is the specification's own name for the one-time
 * approval the `permit2` method needs before a first payment.
 */
export const INVALID_REASONS = [
  "insufficient_funds",
  "invalid_signature",
  "invalid_amount",
  "invalid_network",
  "invalid_scheme",
  "invalid_asset",
  "invalid_recipient",
  "expired_authorization",
  "authorization_not_yet_valid",
  "authorization_already_used",
  "simulation_failed",
  "unsupported_asset_transfer_method",
  "PERMIT2_ALLOWANCE_REQUIRED",
] as const;

export type InvalidReason = (typeof INVALID_REASONS)[number];
