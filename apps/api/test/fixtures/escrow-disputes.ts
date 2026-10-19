/**
 * In-memory dispute log (#313) for tests — the Postgres one is
 * `DrizzleEscrowDisputeRepository`, exercised in `packages/db`.
 */

import type {
  DisputeAlert,
  DisputeAuthor,
  DisputeMessage,
  EscrowDispute,
  OpenDispute,
} from "@mayarin/db";
import type { EscrowDisputeLog } from "../../src/services/escrow-dispute.ts";

export class InMemoryEscrowDisputeLog implements EscrowDisputeLog {
  readonly disputes = new Map<string, EscrowDispute>();
  readonly messages: DisputeMessage[] = [];
  #next = 0;

  async open(input: OpenDispute, now: Date): Promise<{ dispute: EscrowDispute; opened: boolean }> {
    const existing = this.disputes.get(input.paymentIntentId);
    if (existing !== undefined) return { dispute: existing, opened: false };
    const dispute: EscrowDispute = {
      ...input,
      id: `dsp_${++this.#next}`,
      status: "open",
      decidedAt: undefined,
      alerted: undefined,
      createdAt: now,
    };
    this.disputes.set(input.paymentIntentId, dispute);
    return { dispute, opened: true };
  }

  async findByPaymentIntentId(paymentIntentId: string): Promise<EscrowDispute | undefined> {
    return this.disputes.get(paymentIntentId);
  }

  async findById(id: string): Promise<EscrowDispute | undefined> {
    return [...this.disputes.values()].find((dispute) => dispute.id === id);
  }

  async listByMerchant(merchantId: string, limit = 100): Promise<readonly EscrowDispute[]> {
    return [...this.disputes.values()]
      .filter((dispute) => dispute.merchantId === merchantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async close(
    paymentIntentId: string,
    status: "released" | "refunded" | "split",
    now: Date,
  ): Promise<EscrowDispute | undefined> {
    const dispute = this.disputes.get(paymentIntentId);
    if (dispute === undefined || dispute.status !== "open") return undefined;
    const closed = { ...dispute, status, decidedAt: now };
    this.disputes.set(paymentIntentId, closed);
    return closed;
  }

  async listOpen(): Promise<readonly EscrowDispute[]> {
    return [...this.disputes.values()]
      .filter((dispute) => dispute.status === "open")
      .sort((a, b) => a.resolveBy.getTime() - b.resolveBy.getTime());
  }

  async markAlerted(id: string, alert: DisputeAlert): Promise<void> {
    for (const [key, dispute] of this.disputes) {
      if (dispute.id === id) this.disputes.set(key, { ...dispute, alerted: alert });
    }
  }

  async listMessages(disputeId: string): Promise<readonly DisputeMessage[]> {
    return this.messages.filter((message) => message.disputeId === disputeId);
  }

  async addMessage(
    disputeId: string,
    author: DisputeAuthor,
    body: string,
    now: Date,
  ): Promise<DisputeMessage> {
    const message = { id: `dsm_${++this.#next}`, disputeId, author, body, createdAt: now };
    this.messages.push(message);
    return message;
  }
}
