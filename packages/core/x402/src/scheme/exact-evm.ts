/**
 * The `exact` scheme on EVM, in the parts that need no chain.
 *
 * The scheme's job is to turn a `PaymentRequirements` into something a payer
 * can sign, and to say — given a signed payload — everything that is wrong with
 * it before anyone spends an RPC call finding out. What is left after that is
 * the four checks that genuinely need the chain (signature recovery, balance,
 * nonce state, simulation), and those live behind the facilitator port.
 *
 * Splitting it this way is not tidiness. `checkStatically` is a pure function
 * over two objects, so the parameter-matching rules — the ones that stop a
 * payer authorising a transfer to somewhere other than the merchant — are
 * tested exhaustively without a node, and a facilitator that forgets to call it
 * fails a test rather than accepting a redirected payment.
 *
 * Spec: https://github.com/coinbase/x402/blob/main/specs/schemes/exact/scheme_exact_evm.md
 */

import { ValidationError } from "@mayarin/shared";
import { parseUnixSeconds } from "../amount.ts";
import type {
  AssetTransferMethod,
  Authorization,
  Eip3009Payload,
  InvalidReason,
  PaymentPayload,
  PaymentRequirements,
} from "../types.ts";
import { isAssetTransferMethod } from "../types.ts";

export const EXACT_SCHEME = "exact";

/**
 * The EIP-712 struct a payer signs, verbatim from the specification.
 *
 * Field order is part of the type hash, so this array is not a list of names —
 * reordering it produces a different digest and every signature stops
 * verifying, silently, against a token that is behaving correctly.
 */
export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/** The EIP-712 domain of the token being transferred. */
export interface Eip712Domain {
  readonly name: string;
  readonly version: string;
  readonly chainId: number;
  readonly verifyingContract: string;
}

/**
 * The token's EIP-712 domain, assembled from the requirements.
 *
 * `name` and `version` come from `extra`, because they are properties of the
 * deployed token rather than of the payment, and getting either wrong yields a
 * domain separator that differs from the contract's — a signature that is
 * perfectly valid and that the token will not accept. USDC is `{"USDC", "2"}`
 * on every chain checked so far, but that is an observation, not a default:
 * a missing `extra` is an error here rather than a guess.
 */
export function domainOf(requirements: PaymentRequirements, chainId: number): Eip712Domain {
  const name = requirements.extra?.name;
  const version = requirements.extra?.version;
  if (typeof name !== "string" || typeof version !== "string") {
    throw new ValidationError(
      'exact/EVM requires extra.name and extra.version — the token\'s EIP-712 domain, e.g. {"name":"USDC","version":"2"}',
    );
  }
  return { name, version, chainId, verifyingContract: requirements.asset };
}

/** The asset transfer method the requirements state, defaulting per the spec. */
export function assetTransferMethodOf(requirements: PaymentRequirements): AssetTransferMethod {
  const stated = requirements.extra?.assetTransferMethod;
  if (stated === undefined) return "eip3009";
  if (!isAssetTransferMethod(stated)) {
    throw new ValidationError(`unknown assetTransferMethod "${String(stated)}"`);
  }
  return stated;
}

const ADDRESS = /^0x[\da-f]{40}$/i;
const BYTES32 = /^0x[\da-f]{64}$/i;
const SIGNATURE = /^0x[\da-f]{130}$/i;

function isEip3009Payload(
  payload: Readonly<Record<string, unknown>>,
): payload is Eip3009Payload & Record<string, unknown> {
  const authorization = payload.authorization;
  return (
    typeof payload.signature === "string" &&
    typeof authorization === "object" &&
    authorization !== null
  );
}

/** The EIP-3009 payload inside a `PaymentPayload`, or a `ValidationError`. */
export function eip3009PayloadOf(payment: PaymentPayload): Eip3009Payload {
  if (!isEip3009Payload(payment.payload)) {
    throw new ValidationError("exact/EIP-3009 payload must carry signature and authorization");
  }
  return payment.payload;
}

/**
 * Everything that can be decided about a payment without touching a chain.
 *
 * Returns the first failure rather than a list: a payer fixes one thing and
 * retries, and a collected report would imply the others were checked against a
 * payload that no longer exists. `undefined` means nothing here is wrong — not
 * that the payment is good.
 *
 * `now` is passed rather than read so the time checks are testable and so this
 * file needs no clock of its own.
 */
export function checkStatically(
  payment: PaymentPayload,
  requirements: PaymentRequirements,
  now: Date,
): InvalidReason | undefined {
  if (payment.accepted.scheme !== EXACT_SCHEME || requirements.scheme !== EXACT_SCHEME) {
    return "invalid_scheme";
  }
  // The payer echoes back the requirements they chose. Comparing the echo
  // against our own copy is what stops a payer signing for a different network,
  // asset or recipient than the one the resource asked for and having the
  // facilitator settle it anyway.
  if (payment.accepted.network !== requirements.network) return "invalid_network";
  if (!equalsAddress(payment.accepted.asset, requirements.asset)) return "invalid_asset";
  if (!equalsAddress(payment.accepted.payTo, requirements.payTo)) return "invalid_recipient";
  if (payment.accepted.amount !== requirements.amount) return "invalid_amount";

  const method = assetTransferMethodOf(requirements);
  if (method !== "eip3009") return "unsupported_asset_transfer_method";

  const { signature, authorization } = eip3009PayloadOf(payment);
  if (!SIGNATURE.test(signature)) return "invalid_signature";

  const reason = checkAuthorization(authorization, requirements, now);
  if (reason !== undefined) return reason;

  return undefined;
}

function checkAuthorization(
  authorization: Authorization,
  requirements: PaymentRequirements,
  now: Date,
): InvalidReason | undefined {
  if (!ADDRESS.test(authorization.from) || !ADDRESS.test(authorization.to)) {
    return "invalid_signature";
  }
  if (!BYTES32.test(authorization.nonce)) return "invalid_signature";

  // The authorization is what the token executes. Requirements the payer echoed
  // correctly but signed differently would settle the signed values, so the
  // authorization is compared against our requirements, not against the echo.
  if (!equalsAddress(authorization.to, requirements.payTo)) return "invalid_recipient";
  if (authorization.value !== requirements.amount) return "invalid_amount";

  const validAfter = parseUnixSeconds(authorization.validAfter, "validAfter");
  const validBefore = parseUnixSeconds(authorization.validBefore, "validBefore");
  const seconds = BigInt(Math.floor(now.getTime() / 1000));

  // EIP-3009 windows are exclusive at both ends: the token requires
  // `validAfter < now < validBefore`, so an authorization is not yet live in
  // the second it names and is dead in the second it expires. Matching the
  // contract here means a payment this function accepts is not one the token
  // then reverts.
  if (seconds <= validAfter) return "authorization_not_yet_valid";
  if (seconds >= validBefore) return "expired_authorization";

  return undefined;
}

/** Addresses compare case-insensitively; EIP-55 checksums are a display form. */
function equalsAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
