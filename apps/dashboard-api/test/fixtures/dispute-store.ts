/** In-memory dispute store (#313) for tests. */

import type { DisputeAuthor, DisputeMessage, EscrowDispute } from "@mayarin/db";
import type { DisputeStore } from "../../src/services/disputes.ts";

export class InMemoryDisputeStore implements DisputeStore {
  readonly disputes: EscrowDispute[] = [];
  readonly messages: DisputeMessage[] = [];

  async findById(id: string) {
    return this.disputes.find((dispute) => dispute.id === id);
  }

  async findByPaymentIntentId(paymentIntentId: string) {
    return this.disputes.find((dispute) => dispute.paymentIntentId === paymentIntentId);
  }

  async listOpen() {
    return this.disputes.filter((dispute) => dispute.status === "open");
  }

  async listByMerchant(merchantId: string) {
    return this.disputes.filter((dispute) => dispute.merchantId === merchantId).reverse();
  }

  async listMessages(disputeId: string) {
    return this.messages.filter((message) => message.disputeId === disputeId);
  }

  async addMessage(disputeId: string, author: DisputeAuthor, body: string, now: Date) {
    const message = {
      id: `dsm_${this.messages.length + 1}`,
      disputeId,
      author,
      body,
      createdAt: now,
    };
    this.messages.push(message);
    return message;
  }
}
