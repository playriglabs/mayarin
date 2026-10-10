/** Transactional delivery of an issued invoice through Resend. */

import {
  EMAIL_FOOTER,
  EMAIL_FOOTER_TEXT,
  EMAIL_HEAD,
  escapeHtml,
  FONT_STACK,
  LOGO_IMG,
  logoImg,
  merchantEmailAttachments,
} from "@mayarin/documents";
import { ConfigurationError, ProviderError } from "@mayarin/shared";
import type { SubscriptionInterval } from "@mayarin/subscriptions";
import { Resend } from "resend";

export interface SendInvoiceEmailRequest {
  readonly invoiceId: string;
  /** Stable for one HTTP attempt and new for a deliberate resend. */
  readonly deliveryId: string;
  readonly invoiceNumber: string;
  readonly merchantName: string;
  /** The merchant's uploaded logo; `undefined` sends Mayarin's. */
  readonly merchantLogoUrl: string | undefined;
  readonly buyerName: string;
  readonly buyerEmail: string;
  readonly total: string;
  readonly outstanding: string;
  readonly dueAt: string | null;
  readonly url: string;
  /**
   * Set when the invoice is one cycle of a subscription (#296). The email then
   * reads as a plan renewing, not as a one-off bill the buyer has never seen.
   */
  readonly subscription?: { readonly plan: string; readonly interval: SubscriptionInterval };
}

const PER: Record<SubscriptionInterval, string> = { week: "week", month: "month", year: "year" };
const CADENCE: Record<SubscriptionInterval, string> = {
  week: "weekly",
  month: "monthly",
  year: "yearly",
};

export interface InvoiceEmailDelivery {
  readonly id: string;
  readonly recipient: string;
}

/** Port injected into the invoice route; tests never reach the network. */
export interface InvoiceEmailSender {
  sendInvoice(request: SendInvoiceEmailRequest): Promise<InvoiceEmailDelivery>;
}

export interface ResendInvoiceEmailSenderOptions {
  readonly apiKey: string;
  readonly from: string;
  /** Overridable for an isolated adapter test. */
  readonly resend?: { readonly emails: Pick<Resend["emails"], "send"> };
}

export class ResendInvoiceEmailSender implements InvoiceEmailSender {
  readonly #from: string;
  readonly #resend: { readonly emails: Pick<Resend["emails"], "send"> };

  constructor(options: ResendInvoiceEmailSenderOptions) {
    this.#from = options.from;
    this.#resend = options.resend ?? new Resend(options.apiKey);
  }

  async sendInvoice(request: SendInvoiceEmailRequest): Promise<InvoiceEmailDelivery> {
    let result: Awaited<ReturnType<Resend["emails"]["send"]>>;
    try {
      result = await this.#resend.emails.send(
        {
          from: this.#from,
          to: request.buyerEmail,
          subject:
            request.subscription === undefined
              ? `${request.merchantName} sent invoice ${request.invoiceNumber}`
              : `Your ${request.subscription.plan} renewal from ${request.merchantName}`,
          html: renderInvoiceHtml(request),
          text: `${renderInvoiceText(request)}\n${EMAIL_FOOTER_TEXT}`,
          attachments: merchantEmailAttachments(request.merchantLogoUrl),
          tags: [
            {
              name: "category",
              value: request.subscription === undefined ? "invoice" : "subscription",
            },
          ],
        },
        // A retried click reuses its delivery id and remains one message. A
        // deliberate later click gets a new delivery id, even when the invoice
        // itself has not changed, so resending remains possible.
        { idempotencyKey: `invoice-${request.invoiceId}-${request.deliveryId}` },
      );
    } catch (error) {
      throw new ProviderError(
        "Resend is unreachable. Try sending the invoice again.",
        { cause: error instanceof Error ? error.message : String(error) },
        { retryable: true },
      );
    }

    if (result.error !== null) {
      const status = result.error.statusCode;
      throw new ProviderError(
        `Resend could not send this invoice: ${result.error.message}`,
        { provider: "resend", status },
        { retryable: status === 429 || (status !== null && status >= 500) },
      );
    }

    return { id: result.data.id, recipient: request.buyerEmail };
  }
}

/** Keeps deployments without email credentials bootable, but fails explicitly on use. */
export class UnavailableInvoiceEmailSender implements InvoiceEmailSender {
  sendInvoice(): Promise<InvoiceEmailDelivery> {
    return Promise.reject(
      new ConfigurationError("Invoice email is not configured. Set RESEND_API_KEY and try again."),
    );
  }
}

function renderInvoiceHtml(request: SendInvoiceEmailRequest): string {
  const merchant = escapeHtml(request.merchantName);
  const buyer = escapeHtml(request.buyerName);
  const number = escapeHtml(request.invoiceNumber);
  const total = escapeHtml(request.total);
  const outstanding = escapeHtml(request.outstanding);
  const url = escapeHtml(request.url);
  const due = request.dueAt === null ? "" : escapeHtml(formatDueDate(request.dueAt));
  const plan = request.subscription;
  const planName = plan === undefined ? "" : escapeHtml(plan.plan);
  const preview =
    plan === undefined
      ? `${merchant} sent invoice ${number} for ${total}.`
      : `Your ${planName} renewal: ${total} per ${PER[plan.interval]}.`;
  const heading = plan === undefined ? `Invoice ${number}` : planName;
  const intro =
    plan === undefined
      ? `Hi ${buyer}, ${merchant} sent you an invoice. Review it securely and choose a supported crypto asset to pay.`
      : `Hi ${buyer}, your ${CADENCE[plan.interval]} ${planName} with ${merchant} is due. Pay it securely with a supported crypto asset.`;
  const button = plan === undefined ? "Review and pay invoice" : "Pay renewal";
  const rows =
    plan === undefined
      ? `<tr><td style="padding:16px;color:#78716c;font-size:13px">Total</td><td align="right" style="padding:16px;font-size:16px;font-weight:500">${total}</td></tr>
              <tr><td style="padding:0 16px 16px;color:#78716c;font-size:13px">Outstanding</td><td align="right" style="padding:0 16px 16px;font-size:16px;font-weight:500">${outstanding}</td></tr>`
      : `<tr><td style="padding:16px;color:#78716c;font-size:13px">Amount</td><td align="right" style="padding:16px;font-size:16px;font-weight:500">${total} <span style="color:#78716c;font-size:13px;font-weight:400">/ ${PER[plan.interval]}</span></td></tr>
              <tr><td style="padding:0 16px 16px;color:#78716c;font-size:13px">Invoice</td><td align="right" style="padding:0 16px 16px;font-size:14px">${number}</td></tr>`;

  return `<!doctype html>
<html lang="en">
${EMAIL_HEAD}
  <body style="margin:0;background:#f5f5f4;color:#1c1917;font-family:${FONT_STACK}">
    <div style="display:none;max-height:0;overflow:hidden">${preview}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f5f4;padding:32px 16px;font-family:${FONT_STACK}">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e7e5e4;border-radius:16px">
          <tr><td style="padding:32px;font-family:${FONT_STACK}">
            ${request.merchantLogoUrl === undefined ? LOGO_IMG : logoImg(request.merchantName)}
            <h1 style="margin:0 0 12px;font-size:28px;font-weight:500;line-height:1.25">${heading}</h1>
            <p style="margin:0 0 28px;color:#57534e;font-size:16px;line-height:1.6">${intro}</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:28px;background:#fafaf9;border:1px solid #f0efee;border-radius:12px;font-family:${FONT_STACK}">
              ${rows}
              ${due === "" ? "" : `<tr><td style="padding:0 16px 16px;color:#78716c;font-size:13px">Due date</td><td align="right" style="padding:0 16px 16px;font-size:14px">${due}</td></tr>`}
            </table>
            <a href="${url}" style="display:inline-block;border-radius:8px;background:#18181b;color:#ffffff;padding:13px 20px;font-size:15px;font-weight:500;font-family:${FONT_STACK};text-decoration:none">${button}</a>
            <p style="margin:28px 0 8px;color:#78716c;font-size:12px;line-height:1.5">If the button does not open:</p>
            <p style="margin:0;font-size:12px;line-height:1.5"><a href="${url}" style="color:#2563eb;font-family:${FONT_STACK}">Pay with this link</a></p>
          </td></tr>
        </table>
        ${EMAIL_FOOTER}
      </td></tr>
    </table>
  </body>
</html>`;
}

function renderInvoiceText(request: SendInvoiceEmailRequest): string {
  const due = request.dueAt === null ? "" : `\nDue date: ${formatDueDate(request.dueAt)}`;
  const plan = request.subscription;
  if (plan !== undefined) {
    return `Hi ${request.buyerName},

Your ${CADENCE[plan.interval]} ${plan.plan} with ${request.merchantName} is due.

Amount: ${request.total} / ${PER[plan.interval]}
Invoice: ${request.invoiceNumber}${due}

Pay renewal: ${request.url}
`;
  }
  return `Hi ${request.buyerName},

${request.merchantName} sent you invoice ${request.invoiceNumber}.

Total: ${request.total}
Outstanding: ${request.outstanding}${due}

Review and pay: ${request.url}
`;
}

function formatDueDate(value: string): string {
  return new Intl.DateTimeFormat("en-ID", {
    dateStyle: "long",
    timeZone: "Asia/Jakarta",
  }).format(new Date(value));
}
