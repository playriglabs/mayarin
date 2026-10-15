/**
 * Step-up for actions that move funds or change where they go (SEC-16).
 *
 * A session alone is not enough: the account must have a proven second factor,
 * and the request must carry a fresh code in `X-MFA-Code`. A bearer API key is
 * refused outright, because a key has no authenticator to ask — an integration
 * that needs to move funds needs a person in the loop.
 *
 * Runs after `requireAuth` and the CSRF check, so an unauthenticated or forged
 * request never reaches the code comparison.
 */

import { ForbiddenError } from "@mayarin/shared";
import type { MiddlewareHandler } from "hono";
import type { MfaService } from "../services/mfa-service.ts";
import { MFA_CODE_REQUIRED, MFA_SETUP_REQUIRED } from "../services/mfa-service.ts";
import type { AuthVars } from "./types.ts";

export const MFA_HEADER = "x-mfa-code";

export function requireMfa(mfa: MfaService): MiddlewareHandler<{ Variables: AuthVars }> {
  return async (c, next) => {
    const verified = c.get("session");
    if (verified === undefined) {
      throw new ForbiddenError("This action needs a signed-in session, not an API key", {
        reason: "session_required",
      });
    }
    if (!mfa.isEnabled(verified.user)) throw MFA_SETUP_REQUIRED;

    const code = c.req.header(MFA_HEADER);
    if (code === undefined || code.trim() === "") throw MFA_CODE_REQUIRED;
    await mfa.verifyCode(verified.user, code.trim());
    await next();
  };
}
