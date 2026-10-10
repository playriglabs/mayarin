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
 * - **Email** — through Resend, to the merchant's admin accounts, in the same
 *   layout as the invoice and verification emails (PP Neue Montreal, logo inline).
 *
 * Neither throws: a failed notice is logged, and the dispute stands either way.
 */

import { chainLabel, shortHash } from "@mayarin/chain";
import type { EscrowDispute } from "@mayarin/db";
import {
  EMAIL_ATTACHMENTS,
  EMAIL_FOOTER,
  EMAIL_FOOTER_TEXT,
  EMAIL_HEAD,
  escapeHtml,
  FONT_STACK,
  LOGO_IMG,
  toRestAttachments,
} from "@mayarin/documents";
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
  const url =
    email.dashboardUrl === undefined
      ? undefined
      : `${email.dashboardUrl.replace(/\/$/, "")}/disputes/${dispute.id}`;
  const response = await (email.fetch ?? fetch)("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${email.apiKey}`,
      "content-type": "application/json",
      // One dispute, one email, however often the opening is retried.
      "idempotency-key": `dispute-opened-${dispute.id}`,
    },
    body: JSON.stringify({
      from: email.from,
      to,
      subject: `Dispute #${reference} opened — please respond`,
      html: renderDisputeHtml(dispute, reference, url),
      text: `${renderDisputeText(dispute, reference, url)}\n${EMAIL_FOOTER_TEXT}`,
      attachments: toRestAttachments(EMAIL_ATTACHMENTS),
      tags: [{ name: "category", value: "dispute" }],
    }),
  });
  if (!response.ok) throw new Error(`Resend answered ${response.status}`);
}

/** "10 October 2026 at 11:21 UTC" — merchants are everywhere, so the zone is named. */
function deadline(value: Date): string {
  return `${new Intl.DateTimeFormat("en-GB", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(value)} UTC`;
}

/** The same layout as the invoice and verification emails (`@mayarin/documents`). */
export function renderDisputeHtml(
  dispute: EscrowDispute,
  reference: string,
  url: string | undefined,
): string {
  const number = escapeHtml(reference);
  const payment = escapeHtml(dispute.paymentIntentId);
  const network = escapeHtml(chainLabel(dispute.chain));
  const buyer = escapeHtml(shortHash(dispute.payer));
  const by = escapeHtml(deadline(dispute.resolveBy));
  const row = (label: string, value: string, mono = false) =>
    `<tr><td style="padding:10px 16px;color:#78716c;font-size:13px;font-family:${FONT_STACK}">${label}</td><td align="right" style="padding:10px 16px;font-size:14px;font-family:${mono ? "ui-monospace,SFMono-Regular,Menlo,monospace" : FONT_STACK}">${value}</td></tr>`;
  const action =
    url === undefined
      ? `<p style="margin:0;color:#57534e;font-size:14px;line-height:1.6;font-family:${FONT_STACK}">Open <strong>Disputes</strong> in your Mayarin dashboard to answer.</p>`
      : `<a href="${escapeHtml(url)}" style="display:inline-block;border-radius:8px;background:#18181b;color:#ffffff;padding:13px 20px;font-size:15px;font-weight:500;font-family:${FONT_STACK};text-decoration:none">Answer the dispute</a>
            <p style="margin:28px 0 8px;color:#78716c;font-size:12px;line-height:1.5;font-family:${FONT_STACK}">If the button does not open:</p>
            <p style="margin:0;font-size:12px;line-height:1.5"><a href="${escapeHtml(url)}" style="color:#2563eb;font-family:${FONT_STACK}">Open dispute #${number}</a></p>`;

  return `<!doctype html>
<html lang="en">
${EMAIL_HEAD}
  <body style="margin:0;background:#f5f5f4;color:#1c1917;font-family:${FONT_STACK}">
    <div style="display:none;max-height:0;overflow:hidden">A buyer opened dispute #${number} on ${payment}. Answer before ${by}.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f5f4;padding:32px 16px;font-family:${FONT_STACK}">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e7e5e4;border-radius:16px">
          <tr><td style="padding:32px;font-family:${FONT_STACK}">
            ${LOGO_IMG}
            <p style="margin:0 0 8px;color:#b91c1c;font-size:14px;font-weight:500;text-transform:capitalize;font-family:${FONT_STACK}">Dispute opened</p>
            <h1 style="margin:0 0 12px;font-size:28px;font-weight:500;line-height:1.25;font-family:${FONT_STACK}">Dispute #${number}</h1>
            <p style="margin:0 0 28px;color:#57534e;font-size:16px;line-height:1.6;font-family:${FONT_STACK}">A buyer disputed a payment held in escrow, so its automatic release to you is stopped. Answer with your evidence — tracking, proof of delivery — or refund the buyer. Mayarin Resolution reads both sides and decides.</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:12px;background:#fafaf9;border:1px solid #f0efee;border-radius:12px;font-family:${FONT_STACK}">
              ${row("Payment", payment, true)}
              ${row("Network", network)}
              ${row("Buyer", buyer, true)}
            </table>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:28px;background:#fef2f2;border:1px solid #fee2e2;border-radius:12px;font-family:${FONT_STACK}">
              <tr><td style="padding:14px 16px;color:#991b1b;font-size:13px;line-height:1.5;font-family:${FONT_STACK}">If nothing is decided by <strong>${by}</strong>, the buyer is refunded.</td></tr>
            </table>
            ${action}
          </td></tr>
        </table>
        ${EMAIL_FOOTER}
      </td></tr>
    </table>
  </body>
</html>`;
}

function renderDisputeText(
  dispute: EscrowDispute,
  reference: string,
  url: string | undefined,
): string {
  return `A buyer opened dispute #${reference} on payment ${dispute.paymentIntentId}.

The automatic release is stopped. Answer with your evidence — tracking, proof of delivery — or refund the buyer. Mayarin Resolution reads both sides and decides.

Network: ${chainLabel(dispute.chain)}
Buyer: ${dispute.payer}
If nothing is decided by ${deadline(dispute.resolveBy)}, the buyer is refunded.

${url === undefined ? "Open Disputes in your Mayarin dashboard to answer." : `Answer the dispute: ${url}`}
`;
}

function log(channel: string, dispute: EscrowDispute, error: unknown): void {
  console.error(
    `[dispute-notifier] ${channel} for ${dispute.id}: ${error instanceof Error ? error.message : String(error)}`,
  );
}
