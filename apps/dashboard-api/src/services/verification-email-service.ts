/** Transactional delivery of an email verification code through Resend. */

import { ConfigurationError, ProviderError } from "@mayarin/shared";
import { Resend } from "resend";
import { EMAIL_HEAD, escapeHtml, FONT_STACK, LOGO_IMG } from "./email-brand.ts";

export interface SendVerificationEmailRequest {
  readonly email: string;
  /** The plaintext code. Held only for the length of this call; never persisted. */
  readonly code: string;
  /** How long the code stays valid, in minutes, as the email tells the reader. */
  readonly expiresInMinutes: number;
}

export interface VerificationEmailDelivery {
  readonly id: string;
}

/** Port injected into the auth route; tests never reach the network. */
export interface VerificationEmailSender {
  sendVerification(request: SendVerificationEmailRequest): Promise<VerificationEmailDelivery>;
}

export interface ResendVerificationEmailSenderOptions {
  readonly apiKey: string;
  readonly from: string;
  /** Overridable for an isolated adapter test. */
  readonly resend?: { readonly emails: Pick<Resend["emails"], "send"> };
}

export class ResendVerificationEmailSender implements VerificationEmailSender {
  readonly #from: string;
  readonly #resend: { readonly emails: Pick<Resend["emails"], "send"> };

  constructor(options: ResendVerificationEmailSenderOptions) {
    this.#from = options.from;
    this.#resend = options.resend ?? new Resend(options.apiKey);
  }

  async sendVerification(
    request: SendVerificationEmailRequest,
  ): Promise<VerificationEmailDelivery> {
    let result: Awaited<ReturnType<Resend["emails"]["send"]>>;
    try {
      result = await this.#resend.emails.send({
        from: this.#from,
        to: request.email,
        subject: `${request.code} is your Mayarin verification code`,
        html: renderVerificationHtml(request),
        text: renderVerificationText(request),
        tags: [{ name: "category", value: "verification" }],
      });
      // Deliberately no idempotency key: every resend is a new code, and a
      // deduplicated second send would leave the reader holding a code the
      // database has already superseded.
    } catch (error) {
      throw new ProviderError(
        "Could not send the verification email. Try again.",
        { cause: error instanceof Error ? error.message : String(error) },
        { retryable: true },
      );
    }

    if (result.error !== null) {
      const status = result.error.statusCode;
      throw new ProviderError(
        `Could not send the verification email: ${result.error.message}`,
        { provider: "resend", status },
        { retryable: status === 429 || (status !== null && status >= 500) },
      );
    }

    return { id: result.data.id };
  }
}

/** Keeps deployments without email credentials bootable, but fails explicitly on use. */
export class UnavailableVerificationEmailSender implements VerificationEmailSender {
  sendVerification(): Promise<VerificationEmailDelivery> {
    return Promise.reject(
      new ConfigurationError(
        "Email verification is not configured. Set RESEND_API_KEY and try again.",
      ),
    );
  }
}

function renderVerificationHtml(request: SendVerificationEmailRequest): string {
  const code = escapeHtml(request.code);
  const minutes = String(request.expiresInMinutes);

  return `<!doctype html>
<html lang="en">
${EMAIL_HEAD}
  <body style="margin:0;background:#f5f5f4;color:#1c1917;font-family:${FONT_STACK}">
    <div style="display:none;max-height:0;overflow:hidden">${code} is your Mayarin verification code.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f5f4;padding:32px 16px;font-family:${FONT_STACK}">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e7e5e4;border-radius:16px">
          <tr><td style="padding:32px;font-family:${FONT_STACK}">
            ${LOGO_IMG}
            <h1 style="margin:0 0 12px;font-size:28px;font-weight:700;line-height:1.25">Confirm your email</h1>
            <p style="margin:0 0 28px;color:#57534e;font-size:16px;line-height:1.6">Enter this code to finish creating your Mayarin account. It expires in ${minutes} minutes.</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:28px;background:#fafaf9;border:1px solid #f0efee;border-radius:12px;font-family:${FONT_STACK}">
              <tr><td align="center" style="padding:24px 16px;font-size:34px;font-weight:700;letter-spacing:.32em;line-height:1">${code}</td></tr>
            </table>
            <p style="margin:0;color:#78716c;font-size:12px;line-height:1.5">If you did not ask for this, ignore this email — the account stays unusable without the code, and nobody can sign in to it.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function renderVerificationText(request: SendVerificationEmailRequest): string {
  return `Confirm your email

Enter this code to finish creating your Mayarin account:

${request.code}

It expires in ${request.expiresInMinutes} minutes. If you did not ask for this, ignore this email.
`;
}
