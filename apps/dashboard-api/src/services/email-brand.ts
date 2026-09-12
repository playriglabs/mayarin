/**
 * The pieces every Mayarin transactional email shares.
 *
 * Extracted when the verification email became the second one: the mark, the
 * font stack and the escaping rule are brand and safety decisions, not
 * per-template ones, and two copies would drift the moment one template is
 * restyled.
 */

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

/** The logo block that opens the card. */
export const LOGO_IMG = `<img src="${LOGO_URL}" width="48" height="48" alt="Mayarin" style="display:block;margin:0 0 24px;border:0;border-radius:8px" />`;

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] ??
      character,
  );
}
