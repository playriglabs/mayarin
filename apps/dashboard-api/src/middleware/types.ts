/**
 * Hono request-scoped variables set by the auth middleware chain.
 *
 * `session`/`scope` are present once a middleware has verified a caller — either
 * the session cookie middleware or the bearer-token (API key) middleware.
 * `authMethod` records which one, so CSRF can skip its double-submit check for a
 * bearer request (a browser does not auto-send `Authorization` cross-origin, so
 * the CSRF threat it defends against does not apply). Downstream middleware
 * (`require-auth`, `csrf`) and routes read these through `c.get`. Optional by
 * design: a public route sees none of them, and `require-auth` is what turns
 * that absence into a 401.
 */

import type { Scope } from "../dto/auth.ts";
import type { VerifiedSession } from "../services/session-service.ts";

export interface AuthVars {
  readonly session?: VerifiedSession;
  readonly scope?: Scope;
  readonly authMethod?: "session" | "api-key";
}
