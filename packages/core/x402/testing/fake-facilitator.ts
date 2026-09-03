/**
 * In-memory facilitator and confirmer, scriptable per call.
 *
 * The point of a fake here is to be able to lie. A real facilitator that
 * reports a settlement which never happened is the failure `confirmSettlement`
 * exists to catch, and it cannot be provoked out of a correct implementation —
 * so the fake settles without confirming, confirms without settling, and
 * reports the wrong amount on request.
 */

import type {
  ConfirmedTransfer,
  PaymentPayload,
  PaymentRequirements,
  SettlementConfirmer,
  SettleResponse,
  VerifyResponse,
  X402Facilitator,
} from "../src/index.ts";
import { eip3009PayloadOf } from "../src/index.ts";

export interface FakeFacilitatorOptions {
  readonly name?: string;
  /** Networks this facilitator claims. Every network when omitted. */
  readonly networks?: readonly string[];
  readonly schemes?: readonly string[];
}

export class FakeFacilitator implements X402Facilitator {
  readonly name: string;
  readonly #networks: readonly string[] | undefined;
  readonly #schemes: readonly string[];

  /** Calls recorded in order, so a test can assert what was asked and when. */
  readonly verified: PaymentPayload[] = [];
  readonly settled: PaymentPayload[] = [];

  #nextVerify: VerifyResponse | undefined;
  #nextSettle: SettleResponse | undefined;

  constructor(options: FakeFacilitatorOptions = {}) {
    this.name = options.name ?? "fake";
    this.#networks = options.networks;
    this.#schemes = options.schemes ?? ["exact"];
  }

  supports(requirements: PaymentRequirements): boolean {
    const network = this.#networks === undefined || this.#networks.includes(requirements.network);
    return network && this.#schemes.includes(requirements.scheme);
  }

  /** The next `verify` answers this instead of accepting. */
  willReject(invalidReason: string, payer?: string): this {
    this.#nextVerify =
      payer === undefined
        ? { isValid: false, invalidReason }
        : { isValid: false, invalidReason, payer };
    return this;
  }

  /** The next `settle` answers this, however implausible. */
  willSettleWith(response: SettleResponse): this {
    this.#nextSettle = response;
    return this;
  }

  async verify(
    payment: PaymentPayload,
    _requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    this.verified.push(payment);
    const scripted = this.#nextVerify;
    this.#nextVerify = undefined;
    if (scripted !== undefined) return scripted;
    return { isValid: true, payer: eip3009PayloadOf(payment).authorization.from };
  }

  async settle(
    payment: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    this.settled.push(payment);
    const scripted = this.#nextSettle;
    this.#nextSettle = undefined;
    if (scripted !== undefined) return scripted;
    return {
      success: true,
      transaction: transactionHashFor(payment),
      network: requirements.network,
      payer: eip3009PayloadOf(payment).authorization.from,
    };
  }
}

/**
 * A confirmer holding whatever transfers a test says the chain holds — which
 * is, by default, nothing. A test that wants a settlement confirmed has to
 * record it, which is the same asymmetry the real system has: broadcasting is
 * not the same event as the chain having it.
 */
export class FakeSettlementConfirmer implements SettlementConfirmer {
  readonly #transfers = new Map<string, ConfirmedTransfer>();

  record(transaction: string, network: string, transfer: ConfirmedTransfer): this {
    this.#transfers.set(keyOf(transaction, network), transfer);
    return this;
  }

  /** Record the transfer the requirements describe, as a payer would make it. */
  recordMatching(transaction: string, requirements: PaymentRequirements, from: string): this {
    return this.record(transaction, requirements.network, {
      from,
      to: requirements.payTo,
      value: requirements.amount,
      asset: requirements.asset,
    });
  }

  async confirm(transaction: string, network: string): Promise<ConfirmedTransfer | undefined> {
    return this.#transfers.get(keyOf(transaction, network));
  }
}

function keyOf(transaction: string, network: string): string {
  return `${network}:${transaction.toLowerCase()}`;
}

/** A deterministic hash derived from the authorization nonce. */
export function transactionHashFor(payment: PaymentPayload): string {
  return eip3009PayloadOf(payment).authorization.nonce;
}
