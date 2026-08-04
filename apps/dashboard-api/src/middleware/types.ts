/**
 * Hono request-scoped variables set by the auth middleware chain.
 *
 * `session`/`scope` are present once the session middleware has verified a
 * bearer cookie. Downstream middleware (`require-auth`, `require-role`, `csrf`)
 * and routes read them through `c.get`. Optional by design: a public route sees
 * no session, and `require-auth` is what turns that absence into a 401.
 */

import type { Scope } from "../dto/auth.ts";
import type { VerifiedSession } from "../services/session-service.ts";

export interface AuthVars {
  readonly session?: VerifiedSession;
  readonly scope?: Scope;
}
