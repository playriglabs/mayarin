/**
 * Escrow disputes (#313), the dashboard side.
 *
 * Two audiences. The merchant answers a dispute over their own payment from
 * the payment detail. Mayarin Resolution — accounts holding the platform
 * permission `disputes:arbitrate` — reads every open dispute it is the arbiter
 * of, and decides from its own wallet: this service never signs, it only reads
 * the case file and appends to the thread.
 *
 * A message is accepted only while the dispute is open. The status follows the
 * chain through the payment API's escrow view, which closes the case file the
 * first time it sees the funds moved.
 */

import type { DisputeAuthor, DisputeMessage, EscrowDispute } from "@mayarin/db";
import { type Clock, ConflictError, NotFoundError, ValidationError } from "@mayarin/shared";
import type { EscrowView, PaymentApiClient } from "./payment-api-client.ts";

const MAX_MESSAGE_LENGTH = 2_000;

/** The slice of the dispute repository this service reads and appends through. */
export interface DisputeStore {
  findById(id: string): Promise<EscrowDispute | undefined>;
  findByPaymentIntentId(paymentIntentId: string): Promise<EscrowDispute | undefined>;
  listOpen(): Promise<readonly EscrowDispute[]>;
  listByMerchant(merchantId: string): Promise<readonly EscrowDispute[]>;
  listMessages(disputeId: string): Promise<readonly DisputeMessage[]>;
  addMessage(
    disputeId: string,
    author: DisputeAuthor,
    body: string,
    now: Date,
  ): Promise<DisputeMessage>;
}

export interface DisputeCase {
  readonly dispute: EscrowDispute;
  readonly messages: readonly DisputeMessage[];
  /** Live from the chain, with the calldata to decide it. */
  readonly escrow: EscrowView;
}

export class DisputeService {
  readonly #store: DisputeStore;
  readonly #paymentApi: PaymentApiClient;
  readonly #arbiter: string | undefined;
  readonly #clock: Clock;

  constructor(options: {
    readonly store: DisputeStore;
    readonly paymentApi: PaymentApiClient;
    /** Mayarin Resolution's address (`ESCROW_ARBITER`); unset, the console has nothing to decide. */
    readonly arbiter: string | undefined;
    readonly clock: Clock;
  }) {
    this.#store = options.store;
    this.#paymentApi = options.paymentApi;
    this.#arbiter = options.arbiter?.toLowerCase();
    this.#clock = options.clock;
  }

  /** The merchant's answer in a dispute over one of their payments. */
  async postMerchantMessage(
    merchantId: string,
    paymentIntentId: string,
    body: string,
  ): Promise<DisputeMessage> {
    const dispute = await this.#store.findByPaymentIntentId(paymentIntentId);
    if (dispute === undefined || dispute.merchantId !== merchantId) {
      throw new NotFoundError("This payment has no dispute", { paymentIntentId });
    }
    return this.#append(dispute, "merchant", body);
  }

  /** A merchant's own disputes, newest first, so they know there is one to answer. */
  async forMerchant(merchantId: string): Promise<readonly EscrowDispute[]> {
    return this.#store.listByMerchant(merchantId);
  }

  /** Open disputes Mayarin Resolution arbitrates, nearest deadline first. */
  async queue(): Promise<readonly EscrowDispute[]> {
    if (this.#arbiter === undefined) return [];
    return (await this.#store.listOpen()).filter((dispute) => dispute.arbiter === this.#arbiter);
  }

  /** One case for the arbiter: record, thread and live escrow. */
  async case(id: string): Promise<DisputeCase> {
    const found = await this.#arbitrated(id);
    // Reading the escrow first lets the payment API close the case file if the
    // funds already moved, so the record read after it is current.
    const escrow = await this.#paymentApi.escrow(found.paymentIntentId);
    const dispute = (await this.#store.findById(id)) ?? found;
    return { dispute, messages: await this.#store.listMessages(id), escrow };
  }

  /** The call for the arbiter's wallet that splits the payment (#315). */
  async resolveCall(id: string, payeeBps: number): Promise<{ to: string; data: string }> {
    const dispute = await this.#arbitrated(id);
    return this.#paymentApi.escrowResolve(dispute.paymentIntentId, payeeBps);
  }

  async postArbiterMessage(id: string, body: string): Promise<DisputeMessage> {
    return this.#append(await this.#arbitrated(id), "arbiter", body);
  }

  async #arbitrated(id: string): Promise<EscrowDispute> {
    const dispute = await this.#store.findById(id);
    if (dispute === undefined || this.#arbiter === undefined || dispute.arbiter !== this.#arbiter) {
      throw new NotFoundError("No such dispute", { id });
    }
    return dispute;
  }

  async #append(
    dispute: EscrowDispute,
    author: DisputeAuthor,
    body: string,
  ): Promise<DisputeMessage> {
    const text = body.trim();
    if (text === "" || text.length > MAX_MESSAGE_LENGTH) {
      throw new ValidationError(`A message is 1–${MAX_MESSAGE_LENGTH} characters`, {});
    }
    if (dispute.status !== "open") {
      throw new ConflictError("This dispute is already decided", { id: dispute.id });
    }
    return this.#store.addMessage(dispute.id, author, text, this.#clock.now());
  }
}
