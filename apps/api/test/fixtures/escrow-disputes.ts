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

  async open(input: OpenDispute, now: Date): Promise<EscrowDispute> {
    const existing = this.disputes.get(input.paymentIntentId);
    if (existing !== undefined) return existing;
    const dispute: EscrowDispute = {
      ...input,
      id: `dsp_${++this.#next}`,
      status: "open",
      decidedAt: undefined,
      alerted: undefined,
      createdAt: now,
    };
    this.disputes.set(input.paymentIntentId, dispute);
    return dispute;
  }

  async findByPaymentIntentId(paymentIntentId: string): Promise<EscrowDispute | undefined> {
    return this.disputes.get(paymentIntentId);
  }

  async close(paymentIntentId: string, status: "released" | "refunded" | "split", now: Date) {
    const dispute = this.disputes.get(paymentIntentId);
    if (dispute === undefined || dispute.status !== "open") return;
    this.disputes.set(paymentIntentId, { ...dispute, status, decidedAt: now });
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
