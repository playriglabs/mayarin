/**
 * Session token handling (SEC-15).
 *
 * A session id is a bearer credential, so the database must not hold it: what
 * is stored is `sessionKey(id)`, and a leaked table or backup cannot be
 * replayed as cookies. The CSRF token is derived from the id rather than
 * stored beside it, so there is one secret to protect and nothing else to
 * leak; it is useless without the id, which the JS-readable cookie never has.
 */

import { createHash, randomBytes } from "node:crypto";

/** The 256-bit random id handed to the browser. */
export function newSessionId(): string {
  return `ses_${randomBytes(32).toString("base64url")}`;
}

/** What the database stores and looks up by. */
export function sessionKey(sessionId: string): string {
  return createHash("sha256").update(`session:${sessionId}`).digest("hex");
}

/** The double-submit token for a session. */
export function csrfTokenOf(sessionId: string): string {
  return createHash("sha256").update(`csrf:${sessionId}`).digest("base64url");
}
