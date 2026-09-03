/**
 * What a merchant registers to make an endpoint payable, and how a
 * `PaymentRequired` is built from it.
 *
 * A resource is priced once, in the merchant's own currency, and offers one or
 * more ways to pay it — USDC on Arc, USDC on Hedera, whatever the deployment
 * has facilitators for. The payer picks. That is the whole shape: fiat pricing
 * in, stablecoin settlement out, which is the same thing Mayarin already does
 * for a checkout, wearing an HTTP header instead of a page.
 *
 * Two rules in this file are load-bearing and easy to lose:
 *
 * 1. **`maxTimeoutSeconds` is derived from the quote lock, never configured
 *    beside it.** This repository has already been burned by the other
 *    arrangement — a quote TTL shorter than the deadline it was paired with
 *    produced `ASSET_RECEIVED` after expiry, an `ExpiredOrder` revert, and
 *    eventually `EXECUTION_EXHAUSTED`. Here the two cannot drift because there
 *    is only one number.
 * 2. **The payer's echo is never the source of requirements.** A payload
 *    carries back the `PaymentRequirements` the payer chose, and
 *    `selectRequirements` uses that only to *look up our own copy*. Verifying
 *    against the echo would verify a payment against its own claims.
 */

import type { ChainId } from "@mayarin/chain";
import { caip2Of } from "@mayarin/chain";
import type { AssetCode, Money } from "@mayarin/shared";
import { ValidationError } from "@mayarin/shared";
import { toAtomicAmount } from "./amount.ts";
import { EXACT_SCHEME } from "./scheme/exact-evm.ts";
import type {
  AssetTransferMethod,
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  ResourceInfo,
} from "./types.ts";
import { X402_VERSION } from "./types.ts";

/**
 * One way a resource can be paid: a token on a chain, into an address.
 *
 * `transferMethod` and `domain` are properties of the deployed token, and both
 * are recorded rather than assumed — the method because it decides whether the
 * payer signs an EIP-3009 authorization or a Permit2 one, the domain because a
 * guessed EIP-712 domain separator yields a signature the token will not
 * accept. Both come from asking the contract at boot, not from configuration.
 */
export interface AcceptedAsset {
  readonly chain: ChainId;
  /** The domain asset, which is what the price is quoted into. */
  readonly asset: AssetCode;
  /** The ERC-20 contract on `chain`. */
  readonly contract: string;
  /** Where the merchant is paid on `chain`. */
  readonly payTo: string;
  /** The token's EIP-712 domain, as the token reports it. */
  readonly domain: { readonly name: string; readonly version: string };
  readonly transferMethod: AssetTransferMethod;
}

export interface X402Resource {
  readonly id: string;
  readonly merchantId: string;
  readonly url: string;
  readonly description?: string;
  readonly mimeType?: string;
  /** The price, in the merchant's own currency. */
  readonly price: Money;
  readonly accepts: readonly AcceptedAsset[];
  /**
   * The longest the merchant will hold this price. A ceiling, not the answer —
   * the quote lock can always be shorter, and then it wins.
   */
  readonly maxTimeoutSeconds: number;
}

/** An `AcceptedAsset` with the price converted into it, and the lock that holds. */
export interface PricedAsset {
  readonly accept: AcceptedAsset;
  /** The price in `accept.asset`. */
  readonly amount: Money;
  /** When the quote that produced `amount` stops being honoured. */
  readonly expiresAt: Date;
}

export interface X402ResourceRepository {
  findById(id: string): Promise<X402Resource | undefined>;
  listByMerchant(merchantId: string): Promise<readonly X402Resource[]>;
  save(resource: X402Resource): Promise<void>;
}

export function resourceInfoOf(resource: X402Resource): ResourceInfo {
  return {
    url: resource.url,
    ...(resource.description === undefined ? {} : { description: resource.description }),
    ...(resource.mimeType === undefined ? {} : { mimeType: resource.mimeType }),
  };
}

/**
 * Build the `402` body for a resource whose price has been quoted into each
 * asset it accepts.
 *
 * Pricing happens outside — the caller holds the `QuoteEngine` — so this stays
 * pure and the quote layer stays the only thing that knows how a price becomes
 * an amount.
 *
 * `error` is the specification's field for saying *why* payment is required,
 * and it is filled because a client that gets a bare 402 with no explanation
 * has to guess whether it forgot the header or sent a bad one.
 */
export function buildPaymentRequired(
  resource: X402Resource,
  priced: readonly PricedAsset[],
  now: Date,
  error = "PAYMENT-SIGNATURE header is required",
): PaymentRequired {
  if (priced.length === 0) {
    throw new ValidationError(`x402 resource ${resource.id} has no priced asset to offer`);
  }

  const maxTimeoutSeconds = timeoutSecondsFor(resource, priced, now);

  return {
    x402Version: X402_VERSION,
    error,
    resource: resourceInfoOf(resource),
    accepts: priced.map((entry) => requirementsFor(entry, maxTimeoutSeconds)),
  };
}

/**
 * How long the payer has: the shortest of the merchant's ceiling and every
 * quote lock on offer.
 *
 * The shortest lock rather than the one the payer picks, because the `402`
 * states a single budget and the payer has not chosen yet. Being conservative
 * here costs a payer a few seconds; being generous means advertising a window
 * during which one of the offered prices has already stopped being real.
 */
function timeoutSecondsFor(
  resource: X402Resource,
  priced: readonly PricedAsset[],
  now: Date,
): number {
  const remaining = priced.map((entry) =>
    Math.floor((entry.expiresAt.getTime() - now.getTime()) / 1000),
  );
  const seconds = Math.min(resource.maxTimeoutSeconds, ...remaining);
  if (seconds <= 0) {
    throw new ValidationError(
      `x402 resource ${resource.id} was priced against a quote that has already expired`,
    );
  }
  return seconds;
}

function requirementsFor(entry: PricedAsset, maxTimeoutSeconds: number): PaymentRequirements {
  if (entry.amount.asset !== entry.accept.asset) {
    throw new ValidationError(
      `x402 price for ${entry.accept.chain} is in ${entry.amount.asset}, the asset accepted is ${entry.accept.asset}`,
    );
  }
  return {
    scheme: EXACT_SCHEME,
    network: caip2Of(entry.accept.chain),
    amount: toAtomicAmount(entry.amount),
    asset: entry.accept.contract,
    payTo: entry.accept.payTo,
    maxTimeoutSeconds,
    extra: {
      name: entry.accept.domain.name,
      version: entry.accept.domain.version,
      assetTransferMethod: entry.accept.transferMethod,
    },
  };
}

/**
 * Our own requirements for the option the payer chose.
 *
 * The payer's `accepted` is read for two fields only — which network, which
 * asset — and everything returned comes from `required`. That distinction is
 * the point of the function: verifying a payment against the requirements it
 * carries would check it against its own claims, and a payer who edits the
 * amount downwards before signing would pass.
 */
export function selectRequirements(
  required: PaymentRequired,
  payment: PaymentPayload,
): PaymentRequirements {
  const chosen = required.accepts.find(
    (candidate) =>
      candidate.network === payment.accepted.network &&
      candidate.asset.toLowerCase() === payment.accepted.asset.toLowerCase(),
  );
  if (chosen === undefined) {
    throw new ValidationError(
      `x402 payment chose ${payment.accepted.asset} on ${payment.accepted.network}, which this resource does not accept`,
    );
  }
  return chosen;
}

/**
 * Whether the payer's authorization expires within the price lock.
 *
 * The `402` states a budget; nothing stops a payer signing a `validBefore` far
 * beyond it. Accepting that would mean holding a signed authorization against a
 * price that has stopped being honoured — the exact arrangement that produced
 * settlement after expiry, and then `EXECUTION_EXHAUSTED`, the last time these
 * two numbers were allowed to differ.
 */
export function authorizationWithinLock(validBefore: bigint, lockExpiresAt: Date): boolean {
  return validBefore <= BigInt(Math.floor(lockExpiresAt.getTime() / 1000));
}
