/**
 * Telling the merchant a dispute was opened (#313).
 *
 * Without this a merchant learns of a dispute only by opening the payment, and
 * the arbiter decides on one side's story. Two channels, each optional:
 *
 * - **Webhook `escrow.disputed`** — one delivery per active endpoint, put on
 *   the same delivery table the dispatcher already drains, so signing, retry
 *   and the dead letter are the ones every payment event gets. The dispute id
 *   is the event id, so a repeat is recognisable.
 * - **Email** — through Resend, to the merchant's admin accounts.
 *
 * Neither throws: a failed notice is logged, and the dispute stands either way.
 */

import type { EscrowDispute } from "@mayarin/db";
import type { WebhookDeliveryRepository, WebhookEndpointRepository } from "@mayarin/notifications";
import { type Clock, generateId, numericReference } from "@mayarin/shared";
import type { DisputeNotifier } from "./escrow-dispute.ts";

export interface DisputeNotifierOptions {
  /** Absent when webhooks are off on this deployment. */
  readonly webhooks?: {
    readonly endpoints: WebhookEndpointRepository;
    readonly deliveries: WebhookDeliveryRepository;
  };
  /** Absent without `RESEND_API_KEY`. */
  readonly email?: {
    readonly apiKey: string;
    readonly from: string;
    /** The merchant's admin addresses. */
    readonly recipients: (merchantId: string) => Promise<readonly string[]>;
    /** Where the dashboard lives, for the link; absent, the email names the page. */
    readonly dashboardUrl?: string;
    readonly fetch?: typeof fetch;
  };
  readonly clock: Clock;
}

export function disputeNotifier(options: DisputeNotifierOptions): DisputeNotifier {
  return {
    async opened(dispute) {
      const reference = numericReference(dispute.id);
      await Promise.all([
        options.webhooks === undefined
          ? undefined
          : enqueueWebhook(options.webhooks, dispute, reference, options.clock).catch(
              (error: unknown) => log("webhook", dispute, error),
            ),
        options.email === undefined
          ? undefined
          : sendEmail(options.email, dispute, reference).catch((error: unknown) =>
              log("email", dispute, error),
            ),
      ]);
    },
  };
}

async function enqueueWebhook(
  webhooks: NonNullable<DisputeNotifierOptions["webhooks"]>,
  dispute: EscrowDispute,
  reference: string,
  clock: Clock,
): Promise<void> {
  const endpoints = await webhooks.endpoints.listActiveByMerchant(dispute.merchantId);
  if (endpoints.length === 0) return;
  const now = clock.now();
  const body = JSON.stringify({
    id: dispute.id,
    type: "escrow.disputed",
    occurredAt: dispute.createdAt.toISOString(),
    data: {
      disputeId: dispute.id,
      reference,
      paymentIntentId: dispute.paymentIntentId,
      chain: dispute.chain,
      payer: dispute.payer,
      resolveBy: dispute.resolveBy.toISOString(),
    },
  });
  await webhooks.deliveries.insertMany(
    endpoints.map((endpoint) => ({
      id: generateId("whd", now.getTime()),
      eventId: dispute.id,
      endpointId: endpoint.id,
      merchantId: dispute.merchantId,
      body,
      status: "PENDING" as const,
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    })),
  );
}

async function sendEmail(
  email: NonNullable<DisputeNotifierOptions["email"]>,
  dispute: EscrowDispute,
  reference: string,
): Promise<void> {
  const to = await email.recipients(dispute.merchantId);
  if (to.length === 0) return;
  const where =
    email.dashboardUrl === undefined
      ? "Open Disputes in your Mayarin dashboard"
      : `${email.dashboardUrl.replace(/\/$/, "")}/disputes/${dispute.id}`;
  const text = [
    `A buyer opened dispute #${reference} on payment ${dispute.paymentIntentId}.`,
    "",
    "The automatic release is stopped. Answer with your evidence — tracking, proof of delivery — or refund the buyer.",
    `If nothing is decided by ${dispute.resolveBy.toUTCString()}, the buyer is refunded.`,
    "",
    where,
  ].join("\n");
  const response = await (email.fetch ?? fetch)("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${email.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: email.from,
      to,
      subject: `Dispute #${reference} opened — please respond`,
      text,
    }),
  });
  if (!response.ok) throw new Error(`Resend answered ${response.status}`);
}

function log(channel: string, dispute: EscrowDispute, error: unknown): void {
  console.error(
    `[dispute-notifier] ${channel} for ${dispute.id}: ${error instanceof Error ? error.message : String(error)}`,
  );
}
