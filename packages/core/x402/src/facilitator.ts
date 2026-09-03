/**
 * The facilitator port, and the guard that stops a facilitator being believed.
 *
 * A facilitator verifies an authorization and broadcasts it. Two kinds exist
 * and the port has to fit both: one Mayarin runs itself against its own
 * treasury, and one belonging to somebody else — Blocky402 on Hedera, say. The
 * second is why this is a port at all. A single hard-coded local settler would
 * have made the remote case a rewrite rather than an adapter.
 *
 * The important part of this file is not the interface. It is
 * `confirmSettlement`: **a facilitator's `success: true` is a claim, not a
 * settlement.** The existing rule for webhooks — a signal, not truth — applies
 * unchanged to a third party who can return whatever JSON it likes. Nothing may
 * advance a payment on the strength of an HTTP response; the transaction is
 * read back off the chain it claims to be on, and checked to move the amount
 * the requirements asked for, to the address they named.
 */

import { ConfigurationError, ProviderError, ValidationError } from "@mayarin/shared";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "./types.ts";

export interface X402Facilitator {
  /** Configuration and logs refer to a facilitator by this ("local", "blocky402"). */
  readonly name: string;
  /**
   * Whether this facilitator can serve these requirements. Both the network and
   * the scheme matter: a facilitator configured for Hedera cannot settle a Base
   * authorization, and one that speaks `exact` cannot settle `upto`.
   */
  supports(requirements: PaymentRequirements): boolean;
  /** Would this authorization go through? No broadcast, no state change. */
  verify(payment: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse>;
  /** Broadcast it. The returned response is a claim until confirmed. */
  settle(payment: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse>;
}

/**
 * Which facilitator serves which requirements.
 *
 * Resolution is by `supports` rather than by a network-keyed map, so a
 * facilitator that serves several networks is configured once, and adding a
 * network to one is not also an edit here.
 */
export interface FacilitatorRegistry {
  /** Throws `ConfigurationError` when nothing configured can serve them. */
  for(requirements: PaymentRequirements): X402Facilitator;
  /** Whether anything can. Used at boot to check every resource is servable. */
  canServe(requirements: PaymentRequirements): boolean;
}

export function facilitatorRegistry(facilitators: readonly X402Facilitator[]): FacilitatorRegistry {
  // Two facilitators claiming the same network is a configuration mistake whose
  // symptom is a payment settling through whichever happens to be first in an
  // array — non-deterministic, and invisible until the two disagree. Caught
  // here, at construction, rather than at the first payment.
  const names = new Set(facilitators.map((f) => f.name));
  if (names.size !== facilitators.length) {
    throw new ConfigurationError("two x402 facilitators share a name");
  }

  return {
    for(requirements) {
      const matches = facilitators.filter((facilitator) => facilitator.supports(requirements));
      const [first, second] = matches;
      if (first === undefined) {
        throw new ConfigurationError(
          `no x402 facilitator serves ${requirements.scheme} on ${requirements.network}`,
        );
      }
      if (second !== undefined) {
        throw new ConfigurationError(
          `${matches.length} x402 facilitators claim ${requirements.scheme} on ` +
            `${requirements.network}: ${matches.map((f) => f.name).join(", ")}`,
        );
      }
      return first;
    },
    canServe(requirements) {
      return facilitators.filter((facilitator) => facilitator.supports(requirements)).length === 1;
    },
  };
}

/**
 * A transfer as the chain records it, not as anyone reported it.
 *
 * Amounts stay strings here because that is what they are on the wire and what
 * the comparison needs; converting to `Money` would require knowing the asset,
 * and this seam deliberately knows only addresses and numbers.
 */
export interface ConfirmedTransfer {
  readonly from: string;
  readonly to: string;
  /** Atomic units. */
  readonly value: string;
  /** The token contract the transfer moved. */
  readonly asset: string;
}

/**
 * Reads a settlement transaction back from the chain.
 *
 * `undefined` for a transaction that is not there — which is the case this
 * exists for, and is not an error condition: a facilitator reporting success
 * for a hash that does not exist is exactly the lie being guarded against.
 */
export interface SettlementConfirmer {
  confirm(transaction: string, network: string): Promise<ConfirmedTransfer | undefined>;
}

/** A settlement that has been read back off the chain and matched. */
export interface ConfirmedSettlement {
  readonly transaction: string;
  readonly network: string;
  readonly payer: string;
  readonly transfer: ConfirmedTransfer;
}

const TX_HASH = /^0x[\da-f]{64}$/i;

/**
 * Turn a facilitator's claim into a settlement, or refuse.
 *
 * Every branch below is a way a facilitator — remote or local, malicious or
 * merely broken — could otherwise cause a payment to be credited without the
 * money having moved. The clearing engine takes a `ConfirmedSettlement`, so the
 * only route to `ASSET_RECEIVED` runs through here.
 */
export async function confirmSettlement(
  response: SettleResponse,
  requirements: PaymentRequirements,
  confirmer: SettlementConfirmer,
): Promise<ConfirmedSettlement> {
  if (!response.success) {
    throw new ProviderError(
      `x402 settlement failed: ${response.errorReason ?? "no reason given"}`,
      { errorReason: response.errorReason ?? null, network: response.network },
      { retryable: false },
    );
  }
  // A success carrying no hash, or a hash-shaped string that is not one, is not
  // a transaction to go looking for.
  if (!TX_HASH.test(response.transaction)) {
    throw new ValidationError(
      `x402 facilitator reported success with transaction "${response.transaction}"`,
    );
  }
  if (response.network !== requirements.network) {
    throw new ValidationError(
      `x402 facilitator settled on ${response.network}, requirements named ${requirements.network}`,
    );
  }

  const transfer = await confirmer.confirm(response.transaction, requirements.network);
  if (transfer === undefined) {
    throw new ProviderError(
      `x402 settlement ${response.transaction} is not on ${requirements.network}`,
      { transaction: response.transaction, network: requirements.network },
      { retryable: true },
    );
  }

  // The transaction exists. It still has to be *this* payment: the right token,
  // the right recipient, the full amount. A real transfer of one atomic unit of
  // some other token would otherwise settle an invoice.
  if (!equalsAddress(transfer.asset, requirements.asset)) {
    throw new ValidationError(
      `x402 settlement moved ${transfer.asset}, requirements named ${requirements.asset}`,
    );
  }
  if (!equalsAddress(transfer.to, requirements.payTo)) {
    throw new ValidationError(
      `x402 settlement paid ${transfer.to}, requirements named ${requirements.payTo}`,
    );
  }
  if (transfer.value !== requirements.amount) {
    throw new ValidationError(
      `x402 settlement moved ${transfer.value}, requirements asked for ${requirements.amount}`,
    );
  }

  return {
    transaction: response.transaction,
    network: response.network,
    payer: transfer.from,
    transfer,
  };
}

function equalsAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
