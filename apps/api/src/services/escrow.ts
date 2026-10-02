/**
 * Escrow view of a payment (#304).
 *
 * Reads the terms the order was signed against, asks the chain where the funds
 * are, and hands back the calldata for each action. Mayarin submits nothing
 * here: the payer, the merchant or the arbiter sends the call from their own
 * wallet, and the factory decides whether they may.
 */

import type { ChainId } from "@mayarin/chain";
import type { DisputeMessage, EscrowDispute } from "@mayarin/db";
import {
  type EscrowAction,
  type EscrowState,
  type EscrowTerms,
  escrowAddress,
  escrowCalldata,
  readEscrowState,
} from "@mayarin/provider-evm";
import {
  type Clock,
  ConfigurationError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@mayarin/shared";
import { createPublicClient, http, type PublicClient } from "viem";
import { disputeOf, type EscrowDisputeLog } from "./escrow-dispute.ts";
import type { PaymentAppService } from "./payment.ts";

/** How long a payer's signed message stays acceptable (#313). */
const SIGNATURE_WINDOW_MS = 10 * 60_000;
const MAX_MESSAGE_LENGTH = 2_000;

/**
 * What the payer's wallet signs to post in a dispute (#313). The payment id
 * and the time bind the signature to this thread and this moment, so a
 * signature cannot be replayed onto another dispute or reused later.
 */
export function disputeMessageText(paymentId: string, signedAt: string, body: string): string {
  return `Mayarin dispute message\nPayment: ${paymentId}\nSigned at: ${signedAt}\n\n${body}`;
}

export interface EscrowView {
  readonly chain: ChainId;
  readonly factory: string;
  readonly address: string;
  readonly token: string;
  readonly terms: EscrowTerms;
  readonly state: EscrowState;
  /** Calldata per action, sent to `factory`. Who may send it is the contract's rule. */
  readonly calls: Readonly<Record<EscrowAction, `0x${string}`>>;
  /** The dispute's case file and thread (#313); absent while nobody has disputed. */
  readonly dispute:
    | { readonly record: EscrowDispute; readonly messages: readonly DisputeMessage[] }
    | undefined;
}

export class EscrowService {
  readonly #payments: PaymentAppService;
  readonly #rpcUrls: Readonly<Partial<Record<ChainId, string>>>;
  readonly #disputes: EscrowDisputeLog;
  readonly #clock: Clock;
  readonly #clients = new Map<ChainId, PublicClient>();

  constructor(
    payments: PaymentAppService,
    rpcUrls: Readonly<Partial<Record<ChainId, string>>>,
    disputes: EscrowDisputeLog,
    clock: Clock,
  ) {
    this.#payments = payments;
    this.#rpcUrls = rpcUrls;
    this.#disputes = disputes;
    this.#clock = clock;
  }

  async view(paymentId: string): Promise<EscrowView> {
    const { intent, transaction } = await this.#payments.getPayment(paymentId);
    const order = transaction?.contract?.order;
    const chain = intent.payment?.chain;
    if (order?.escrow === undefined || chain === undefined) {
      throw new NotFoundError(`Payment ${paymentId} is not held in escrow`, { paymentId });
    }

    const { factory, payer, payee, arbiter, releaseAfter, resolveBy, bond } = order.escrow;
    const terms: EscrowTerms = {
      intentId: order.intentId as `0x${string}`,
      payer,
      payee,
      arbiter,
      releaseAfter,
      resolveBy,
      ...(bond === undefined ? {} : { bond }),
    };
    const token = order.settlementToken;
    const state = await readEscrowState(this.#client(chain), terms, token, factory);

    // The case file follows the chain: opened the first time anyone sees the
    // dispute, closed once the funds have moved.
    const now = this.#clock.now();
    let record = await this.#disputes.findByPaymentIntentId(intent.id);
    if (record === undefined && state.disputed) {
      record = await this.#disputes.open(
        disputeOf(order, { paymentIntentId: intent.id, merchantId: intent.merchant.id, chain }),
        now,
      );
    }
    if (record !== undefined && record.status === "open" && state.outcome !== "held") {
      await this.#disputes.close(intent.id, state.outcome, now);
      record = { ...record, status: state.outcome, decidedAt: now };
    }

    return {
      chain,
      factory,
      address: escrowAddress(terms, factory),
      token,
      terms,
      state,
      calls: {
        release: escrowCalldata("release", terms, token),
        refund: escrowCalldata("refund", terms, token),
        dispute: escrowCalldata("dispute", terms, token),
      },
      dispute:
        record === undefined
          ? undefined
          : { record, messages: await this.#disputes.listMessages(record.id) },
    };
  }

  /**
   * A message from the payer in their dispute (#313). Checkout has no session,
   * so the payer proves who they are by signing with the wallet the escrow
   * refunds to — the same wallet that opened the dispute.
   */
  async postPayerMessage(
    paymentId: string,
    input: { readonly body: string; readonly signedAt: string; readonly signature: string },
  ): Promise<DisputeMessage> {
    const body = input.body.trim();
    if (body === "" || body.length > MAX_MESSAGE_LENGTH) {
      throw new ValidationError(`A message is 1–${MAX_MESSAGE_LENGTH} characters`, {});
    }
    const now = this.#clock.now();
    const signedAt = Date.parse(input.signedAt);
    if (Number.isNaN(signedAt) || Math.abs(now.getTime() - signedAt) > SIGNATURE_WINDOW_MS) {
      throw new ValidationError("The signature has expired; sign the message again", {});
    }

    const view = await this.view(paymentId);
    if (view.dispute === undefined) {
      throw new ConflictError("This escrow is not disputed", { paymentId });
    }
    if (view.dispute.record.status !== "open") {
      throw new ConflictError("This dispute is already decided", { paymentId });
    }
    const signed = await this.#client(view.chain).verifyMessage({
      address: view.terms.payer as `0x${string}`,
      message: disputeMessageText(paymentId, input.signedAt, body),
      signature: input.signature as `0x${string}`,
    });
    if (!signed) {
      throw new ForbiddenError("Sign with the wallet you paid with", {});
    }
    return this.#disputes.addMessage(view.dispute.record.id, "payer", body, now);
  }

  #client(chain: ChainId): PublicClient {
    const existing = this.#clients.get(chain);
    if (existing !== undefined) return existing;
    const rpcUrl = this.#rpcUrls[chain];
    if (rpcUrl === undefined) {
      throw new ConfigurationError(`No RPC URL for ${chain}; escrow state cannot be read`, {
        chain,
      });
    }
    const client = createPublicClient({ transport: http(rpcUrl) });
    this.#clients.set(chain, client);
    return client;
  }
}
