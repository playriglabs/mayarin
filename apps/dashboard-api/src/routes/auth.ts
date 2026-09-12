/**
 * Auth routes.
 *
 * `POST /auth/register` creates a merchant and emails a verification code.
 * `POST /auth/verify-email` redeems that code; `POST /auth/resend-verification`
 * issues a new one. All three are unauthenticated and answer identically for a
 * known and an unknown address.
 * `POST /auth/login` verifies credentials and issues session+CSRF cookies.
 * `POST /auth/logout` revokes the session and clears the cookies (CSRF-guarded).
 * `GET /auth/me` returns the currently authenticated user.
 *
 * Thin: validate → run one app service `Effect` → shape response. A rejected
 * `Effect` throws, and the error handler maps the `MayarinError` to HTTP — no
 * second mapping layer in the route.
 */

import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import type { Container } from "../container.ts";
import {
  CSRF_COOKIE,
  clearCookieOptions,
  csrfCookieOptions,
  loginBodySchema,
  registerBodySchema,
  resendVerificationBodySchema,
  SESSION_COOKIE,
  sessionCookieOptions,
  toUserDto,
  verifyEmailBodySchema,
} from "../dto/auth.ts";
import { runEffect } from "../effect.ts";
import { csrfMiddleware } from "../middleware/csrf.ts";
import { requireAuth } from "../middleware/require-auth.ts";
import type { AuthVars } from "../middleware/types.ts";

export function authRoutes(container: Container): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();
  const { config, auth, sessions } = container;
  const secure = config.cookieSecure;
  const ttl = config.sessionTtlSeconds;

  app.post("/login", async (c) => {
    const { email, password } = loginBodySchema.parse(await c.req.json());
    const { user, session } = await runEffect(auth.login(email, password));
    setCookie(c, SESSION_COOKIE, session.id, sessionCookieOptions(ttl, secure));
    setCookie(c, CSRF_COOKIE, session.csrfToken, csrfCookieOptions(ttl, secure));
    return c.json({ user: toUserDto(user) });
  });

  /**
   * Self-registration. Always `202`, and always the same body.
   *
   * Accepted rather than created, because what the caller gets is a code in
   * flight rather than a usable account — and the response says nothing about
   * whether the address was already registered. See `RegistrationService`.
   */
  app.post("/register", async (c) => {
    const body = registerBodySchema.parse(await c.req.json());
    await container.registrations.register(body);
    return c.json({ ok: true }, 202);
  });

  app.post("/verify-email", async (c) => {
    const body = verifyEmailBodySchema.parse(await c.req.json());
    await container.registrations.verify(body);
    return c.json({ ok: true });
  });

  app.post("/resend-verification", async (c) => {
    const { email } = resendVerificationBodySchema.parse(await c.req.json());
    await container.registrations.resend(email);
    return c.json({ ok: true }, 202);
  });

  app.post("/logout", requireAuth(), csrfMiddleware(), async (c) => {
    const verified = c.get("session");
    if (verified !== undefined) {
      await runEffect(sessions.revoke(verified.session.id));
    }
    setCookie(c, SESSION_COOKIE, "", clearCookieOptions(secure));
    setCookie(c, CSRF_COOKIE, "", clearCookieOptions(secure));
    return c.json({ ok: true });
  });

  app.get("/me", (c) => {
    const verified = c.get("session");
    if (verified === undefined) return c.json({ user: null });
    return c.json({ user: toUserDto(verified.user) });
  });

  return app;
}
