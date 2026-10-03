/**
 * The pieces every Mayarin transactional email shares.
 *
 * Extracted when the verification email became the second one: the mark, the
 * font stack and the escaping rule are brand and safety decisions, not
 * per-template ones, and two copies would drift the moment one template is
 * restyled. Here rather than in one app since the dispute email (#313) is sent
 * by the payment API while the others are sent by the dashboard API.
 */

import { EMAIL_ICON_PNG, LINKEDIN_ICON_PNG, X_ICON_PNG } from "./email-icons.ts";

/**
 * The Mayarin mark, as a PNG on the public site.
 *
 * A remote PNG rather than the SVG in the brand kit or an inline data URI:
 * Gmail renders neither. Served from the marketing origin, which is deployed
 * independently of any API host, so the image does not 404 in an inbox while a
 * deployment is mid-flight. `alt` carries the brand for a client that blocks
 * images by default, which is most of them on first open.
 */
export const LOGO_URL = "https://mayarin.xyz/android-chrome-512x512.png";

/**
 * The font every element in an email names inline.
 *
 * Inline on each element rather than once on `body`: Gmail and Outlook do not
 * inherit a body font into table cells, so a stack declared in one place
 * silently becomes Times New Roman in exactly the clients that matter. Geist
 * leads and the system stack follows, so a client that never fetched the web
 * font still renders in its own UI face rather than a serif default.
 */
export const FONT_STACK =
  "Geist,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** The `<head>` every template opens with: charset, viewport, and the web font. */
export const EMAIL_HEAD = `  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <!-- Geist where the client will fetch a web font (Apple Mail, most desktop
         clients). Gmail strips this link, which is why every element below also
         carries the full stack inline and the layout never depends on the face
         that actually loads. -->
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;700&display=swap"
    />
  </head>`;

/**
 * The logo travels inside the message as an inline attachment, referenced by
 * `cid:`. A remote `src` is blocked by default in Apple Mail (Privacy
 * Protection), Outlook and most first opens, which showed a broken image above
 * every invoice. Resend fetches `LOGO_URL` once at send time and embeds it.
 */
const LOGO_CID = "mayarin-logo";

/** Pass in `attachments` on every send that renders `LOGO_IMG`. */
export const LOGO_ATTACHMENT = {
  path: LOGO_URL,
  filename: "mayarin.png",
  contentType: "image/png",
  contentId: LOGO_CID,
} as const;

/** The logo block that opens the card. */
export const LOGO_IMG = logoImg("Mayarin");

/** The logo block, with the `alt` naming whose logo it is. */
export function logoImg(alt: string): string {
  return `<img src="cid:${LOGO_CID}" width="48" height="48" alt="${escapeHtml(alt)}" style="display:block;margin:0 0 24px;border:0;border-radius:8px" />`;
}

export const MAYARIN_EMAIL = "hello@mayarin.xyz";
export const MAYARIN_X_URL = "https://x.com/mayarin_xyz";
export const MAYARIN_LINKEDIN_URL = "https://linkedin.com/company/mayarin";
const MAYARIN_SITE_URL = "https://mayarin.xyz";

/**
 * Every attachment a Mayarin email carries: the logo, and the footer icons.
 * In the SDK's camelCase shape; a raw REST send maps it with `toRestAttachments`.
 */
export const EMAIL_ATTACHMENTS = [
  LOGO_ATTACHMENT,
  { content: X_ICON_PNG, filename: "x.png", contentType: "image/png", contentId: "mayarin-x" },
  {
    content: LINKEDIN_ICON_PNG,
    filename: "linkedin.png",
    contentType: "image/png",
    contentId: "mayarin-linkedin",
  },
  {
    content: EMAIL_ICON_PNG,
    filename: "email.png",
    contentType: "image/png",
    contentId: "mayarin-email",
  },
] as const;

/**
 * `EMAIL_ATTACHMENTS` with the merchant's logo in place of Mayarin's, for an
 * email a merchant sends its buyer (an invoice, a subscription bill). The
 * footer icons stay: Mayarin is still who delivered it.
 */
export function merchantEmailAttachments(logoUrl: string | undefined) {
  if (logoUrl === undefined) return [...EMAIL_ATTACHMENTS];
  const png = logoUrl.toLowerCase().endsWith(".png");
  const [, ...icons] = EMAIL_ATTACHMENTS;
  return [
    {
      path: logoUrl,
      filename: png ? "logo.png" : "logo.jpg",
      contentType: png ? "image/png" : "image/jpeg",
      contentId: LOGO_CID,
    },
    ...icons,
  ];
}

/** `EMAIL_ATTACHMENTS` in the REST API's snake_case — what the SDK sends on the wire. */
export function toRestAttachments(
  attachments: readonly {
    readonly path?: string;
    readonly content?: string;
    readonly filename: string;
    readonly contentType: string;
    readonly contentId: string;
  }[],
): readonly Record<string, string>[] {
  return attachments.map((attachment) => ({
    ...(attachment.path === undefined ? {} : { path: attachment.path }),
    ...(attachment.content === undefined ? {} : { content: attachment.content }),
    filename: attachment.filename,
    content_type: attachment.contentType,
    content_id: attachment.contentId,
  }));
}

const footerIcon = (href: string, cid: string, alt: string) =>
  `<a href="${href}" style="display:inline-block;margin:0 8px;text-decoration:none"><img src="cid:${cid}" width="20" height="20" alt="${alt}" style="display:block;border:0" /></a>`;

/**
 * The footer under every card: where to find Mayarin and what it is. Placed
 * after the card's table, inside the same centred cell.
 */
export const EMAIL_FOOTER = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;font-family:${FONT_STACK}">
          <tr><td align="center" style="padding:24px 16px 0">
            ${footerIcon(MAYARIN_X_URL, "mayarin-x", "X")}${footerIcon(MAYARIN_LINKEDIN_URL, "mayarin-linkedin", "LinkedIn")}${footerIcon(`mailto:${MAYARIN_EMAIL}`, "mayarin-email", "Email")}
          </td></tr>
          <tr><td align="center" style="padding:16px 16px 0;color:#78716c;font-size:12px;line-height:1.6;font-family:${FONT_STACK}">
            Mayarin — Your business a world of ways to pay.
          </td></tr>
          <tr><td align="center" style="padding:4px 16px 0;color:#78716c;font-size:12px;line-height:1.6;font-family:${FONT_STACK}">
            <a href="mailto:${MAYARIN_EMAIL}" style="color:#57534e;text-decoration:none">${MAYARIN_EMAIL}</a> · <a href="${MAYARIN_SITE_URL}" style="color:#57534e;text-decoration:none">mayarin.xyz</a>
          </td></tr>
        </table>`;

/** The plain-text footer, for the `text` part. */
export const EMAIL_FOOTER_TEXT = `--
Mayarin — Your business a world of ways to pay.
${MAYARIN_EMAIL} · ${MAYARIN_SITE_URL}
X: ${MAYARIN_X_URL} · LinkedIn: ${MAYARIN_LINKEDIN_URL}
`;

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] ??
      character,
  );
}
