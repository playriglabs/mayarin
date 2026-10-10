/**
 * Telling the merchant they got paid — by email, through Resend.
 *
 * "Paid" is the moment the money is the merchant's, which is two moments:
 *
 * - A payment without buyer protection is paid at `SUCCESS`. Those are read
 *   off the clearing event log with their own cursor (`paid-email`), the same
 *   way the webhook dispatcher reads it, so the engine is not touched.
 * - An escrowed payment is not paid at `SUCCESS` — it can still be disputed and
 *   refunded. It is paid when the escrow releases with no dispute, which the
 *   escrow keeper reports through `released`.
 *
 * On its first run there is no cursor, and every payment ever made is "after"
 * it; only events from this process's start are mailed, so turning the email
 * on does not send the whole history.
 *
 * Nothing here throws: a failed email is logged and the payment stands. Resend's
 * idempotency key is the payment, so a repeat inside its window is one email.
 */

import type { ClearingTransaction } from "@mayarin/clearing";
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
import type { WebhookCursorRepository, WebhookOutbox } from "@mayarin/notifications";
import { type Clock, formatMoneyLocale, type Money, numericReference } from "@mayarin/shared";

export interface PaidNotifierOptions {
  readonly outbox: WebhookOutbox;
  readonly cursor: WebhookCursorRepository;
  readonly transactions: {
    findById(id: string): Promise<ClearingTransaction | null>;
  };
  readonly email: {
    readonly apiKey: string;
    readonly from: string;
    /** The merchant's admin addresses. */
    readonly recipients: (merchantId: string) => Promise<readonly string[]>;
    /** Where the dashboard lives, for the link; absent, the email names the page. */
    readonly dashboardUrl?: string;
    readonly fetch?: typeof fetch;
  };
  readonly clock: Clock;
  readonly batchSize?: number;
}

export class PaidNotifier {
  readonly #options: PaidNotifierOptions;
  readonly #since: Date;

  constructor(options: PaidNotifierOptions) {
    this.#options = options;
    this.#since = options.clock.now();
  }

  /** One pass over the clearing log: mails every payment that completed without escrow. */
  async tick(): Promise<number> {
    const cursor = await this.#options.cursor.get();
    const events = await this.#options.outbox.listAfter(cursor, this.#options.batchSize ?? 50);
    let sent = 0;
    for (const event of events) {
      if (event.state !== "SUCCESS") continue;
      if (cursor === undefined && event.occurredAt.getTime() < this.#since.getTime()) continue;
      const transaction = await this.#options.transactions.findById(event.clearingTransactionId);
      // Escrowed: not paid yet. `released` mails it when the hold ends undisputed.
      if (transaction === null || transaction.contract?.order.escrow !== undefined) continue;
      if (await this.#send(transaction)) sent += 1;
    }
    const last = events[events.length - 1];
    if (last !== undefined) await this.#options.cursor.set(last.id);
    return sent;
  }

  /** An escrow released with no dispute: the merchant is paid now. */
  async released(clearingTransactionId: string): Promise<void> {
    const transaction = await this.#options.transactions.findById(clearingTransactionId);
    if (transaction !== null) await this.#send(transaction);
  }

  async #send(transaction: ClearingTransaction): Promise<boolean> {
    try {
      const { email } = this.#options;
      const to = await email.recipients(transaction.merchant.id);
      if (to.length === 0) return false;
      const reference = numericReference(transaction.paymentIntentId);
      const amount = formatMoneyLocale(paidAmount(transaction), { trimTrailingZeros: true });
      const url =
        email.dashboardUrl === undefined
          ? undefined
          : `${email.dashboardUrl.replace(/\/$/, "")}/payments/${transaction.paymentIntentId}`;
      const response = await (email.fetch ?? fetch)("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${email.apiKey}`,
          "content-type": "application/json",
          "idempotency-key": `payment-paid-${transaction.paymentIntentId}`,
        },
        body: JSON.stringify({
          from: email.from,
          to,
          subject: `🎉 You got paid ${amount}`,
          html: renderPaidHtml(amount, reference, url),
          text: `${renderPaidText(amount, reference, url)}\n${EMAIL_FOOTER_TEXT}`,
          attachments: toRestAttachments(EMAIL_ATTACHMENTS),
          tags: [{ name: "category", value: "payment-paid" }],
        }),
      });
      if (!response.ok) throw new Error(`Resend answered ${response.status}`);
      return true;
    } catch (error) {
      console.error(
        `[paid-notifier] email for ${transaction.paymentIntentId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }
}

/** What reached the merchant: net of fees when known, else what was settled, else what was asked. */
function paidAmount(transaction: ClearingTransaction): Money {
  return transaction.netAmount ?? transaction.settlementAmount ?? transaction.sourceAmount;
}

/** The same layout as the dispute, invoice and verification emails (`@mayarin/documents`). */
export function renderPaidHtml(amount: string, reference: string, url: string | undefined): string {
  const value = escapeHtml(amount);
  const number = escapeHtml(reference);
  const cell = `font-family:${FONT_STACK};font-size:14px;line-height:1.5`;
  const action =
    url === undefined
      ? `<p style="margin:0;color:#57534e;font-size:14px;line-height:1.6;font-family:${FONT_STACK}">Open Payments in your Mayarin dashboard for the details.</p>`
      : `<a href="${escapeHtml(url)}" style="display:inline-block;border-radius:999px;background:#0a0a0a;color:#ffffff;padding:12px 22px;font-size:14px;font-weight:500;font-family:${FONT_STACK};text-decoration:none">View payment</a>`;

  // The amount is the news, so it is the headline; one sentence says what it
  // means, and the reference sits in a quiet row for whoever reconciles it.
  return `<!doctype html>
<html lang="en">
${EMAIL_HEAD}
  <body style="margin:0;background:#f5f5f4;color:#0a0a0a;font-family:${FONT_STACK}">
    <div style="display:none;max-height:0;overflow:hidden">You got paid ${value}. Payment #${number} settled with no dispute.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f5f4;padding:32px 16px;font-family:${FONT_STACK}">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border:1px solid #e7e5e4;border-radius:20px">
          <tr><td style="padding:36px 32px 32px;font-family:${FONT_STACK}">
            ${LOGO_IMG}
            <p style="margin:0 0 6px;color:#78716c;font-size:14px;font-family:${FONT_STACK}">You got paid</p>
            <h1 style="margin:0 0 12px;font-size:36px;font-weight:400;line-height:1.15;letter-spacing:-0.02em;font-family:${FONT_STACK}">${value}</h1>
            <p style="margin:0 0 24px;color:#57534e;font-size:15px;line-height:1.6;font-family:${FONT_STACK}">The payment completed with no dispute and has been settled to you.</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 28px;border-top:1px solid #f0efee;border-bottom:1px solid #f0efee">
              <tr><td style="padding:12px 0 6px;color:#78716c;${cell}">Reference</td><td align="right" style="padding:12px 0 6px;color:#0a0a0a;${cell}">#${number}</td></tr>
              <tr><td style="padding:6px 0 12px;color:#78716c;${cell}">Status</td><td align="right" style="padding:6px 0 12px;color:#15803d;${cell}">Settled</td></tr>
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

function renderPaidText(amount: string, reference: string, url: string | undefined): string {
  return `You got paid ${amount}.

The payment completed with no dispute and has been settled to you.
Reference: #${reference}

${url === undefined ? "Open Payments in your Mayarin dashboard for the details." : `View payment: ${url}`}
`;
}
