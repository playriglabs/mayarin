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

import { clientId } from "@mayarin/http";
import { ForbiddenError, generateId, ID_PREFIXES, UnauthorizedError } from "@mayarin/shared";
import { Effect } from "effect";
import { type Context, Hono } from "hono";
import { setCookie } from "hono/cookie";
import type { Container } from "../container.ts";
import {
  CSRF_COOKIE,
  changePasswordBodySchema,
  clearCookieOptions,
  csrfCookieOptions,
  forgotPasswordBodySchema,
  loginBodySchema,
  mfaCodeBodySchema,
  mfaLoginBodySchema,
  registerBodySchema,
  resendVerificationBodySchema,
  resetPasswordBodySchema,
  SESSION_COOKIE,
  sessionCookieOptions,
  toUserDto,
  verifyEmailBodySchema,
} from "../dto/auth.ts";
import { runEffect } from "../effect.ts";
import { csrfMiddleware } from "../middleware/csrf.ts";
import { requireAuth } from "../middleware/require-auth.ts";
import type { AuthVars } from "../middleware/types.ts";

/** The verified session behind a route that is only meaningful for a person. */
function requireSession(c: { get: (key: "session") => AuthVars["session"] }) {
  const verified = c.get("session");
  if (verified === undefined) {
    throw new ForbiddenError("This needs a signed-in session, not an API key", {});
  }
  return verified;
}

export function authRoutes(container: Container): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();
  const { config, auth, sessions } = container;
  const secure = config.cookieSecure;
  const ttl = config.sessionTtlSeconds;

  const signIn = async (c: Context, userId: string) => {
    const { session } = await runEffect(
      sessions.create(userId).pipe(Effect.map((created) => ({ session: created }))),
    );
    await container.loginEvents.append({
      id: generateId(ID_PREFIXES.loginEvent),
      userId,
      ip: clientId(c, config.rateLimitClientIpSource),
      userAgent: (c.req.header("user-agent") ?? "").slice(0, 300),
      createdAt: session.createdAt,
    });
    setCookie(c, SESSION_COOKIE, session.id, sessionCookieOptions(ttl, secure));
    setCookie(c, CSRF_COOKIE, session.csrfToken, csrfCookieOptions(ttl, secure));
  };

  /**
   * Password step. An account with a second factor gets a challenge instead of
   * a session: nothing is set, and the code step below finishes the sign-in.
   */
  app.post("/login", async (c) => {
    const { email, password } = loginBodySchema.parse(await c.req.json());
    const user = await runEffect(auth.authenticate(email, password));
    if (container.mfa.isEnabled(user)) {
      return c.json({ mfaRequired: true, challenge: container.mfa.issueChallenge(user.id) });
    }
    await signIn(c, user.id);
    return c.json({ user: toUserDto(user) });
  });

  app.post("/login/mfa", async (c) => {
    const { challenge, code } = mfaLoginBodySchema.parse(await c.req.json());
    const userId = container.mfa.redeemChallenge(challenge);
    const user = await container.mfa.findUser(userId);
    if (user === null) throw new UnauthorizedError("Invalid verification code");
    await container.mfa.verifyCode(user, code);
    await signIn(c, user.id);
    return c.json({ user: toUserDto(user) });
  });

  /** Starts enrolment: the secret and QR to scan. Nothing is enforced until it is confirmed. */
  app.post("/mfa/setup", requireAuth(), csrfMiddleware(), async (c) => {
    const verified = requireSession(c);
    return c.json(await container.mfa.beginSetup(verified.user));
  });

  /** Confirms enrolment with a code from the app; the recovery codes are shown once. */
  app.post("/mfa/verify", requireAuth(), csrfMiddleware(), async (c) => {
    const verified = requireSession(c);
    const { code } = mfaCodeBodySchema.parse(await c.req.json());
    const recoveryCodes = await container.mfa.confirmSetup(verified.user, code);
    await container.sessions.revokeOthers(verified.user.id, verified.session.id);
    return c.json({ enabled: true, recoveryCodes });
  });

  /** The last 50 sign-ins to this account, newest first. */
  app.get("/login-history", requireAuth(), async (c) => {
    const verified = requireSession(c);
    const events = await container.loginEvents.listByUser(verified.user.id, 50);
    return c.json({
      logins: events.map((event) => ({
        id: event.id,
        ip: event.ip,
        userAgent: event.userAgent,
        createdAt: event.createdAt.toISOString(),
      })),
    });
  });

  /** Signs out every other device. */
  app.post("/sessions/revoke-others", requireAuth(), csrfMiddleware(), async (c) => {
    const verified = requireSession(c);
    await container.sessions.revokeOthers(verified.user.id, verified.session.id);
    return c.json({ revoked: true });
  });

  app.post("/mfa/disable", requireAuth(), csrfMiddleware(), async (c) => {
    const verified = requireSession(c);
    const { code } = mfaCodeBodySchema.parse(await c.req.json());
    await container.mfa.disable(verified.user, code);
    await container.sessions.revokeOthers(verified.user.id, verified.session.id);
    return c.json({ enabled: false });
  });

  /** Changes the password; every other device is signed out. */
  app.post("/password/change", requireAuth(), csrfMiddleware(), async (c) => {
    const verified = requireSession(c);
    const body = changePasswordBodySchema.parse(await c.req.json());
    await container.passwords.change(verified.user, {
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
      ...(body.code === undefined ? {} : { code: body.code }),
    });
    await container.sessions.revokeOthers(verified.user.id, verified.session.id);
    return c.json({ ok: true });
  });

  /** Emails a reset code. Always `202`, whether or not the address has an account. */
  app.post("/password/forgot", async (c) => {
    const { email } = forgotPasswordBodySchema.parse(await c.req.json());
    await container.passwords.requestReset(email);
    return c.json({ ok: true }, 202);
  });

  /** Redeems the code, sets the password and signs out every device. */
  app.post("/password/reset", async (c) => {
    const body = resetPasswordBodySchema.parse(await c.req.json());
    const user = await container.passwords.reset({
      email: body.email,
      code: body.code,
      newPassword: body.newPassword,
      ...(body.mfaCode === undefined ? {} : { mfaCode: body.mfaCode }),
    });
    await container.sessions.revokeOthers(user.id, "");
    return c.json({ ok: true });
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
    if (body.displayCurrency !== undefined) {
      await container.displayRates.assertKnown(body.displayCurrency);
    }
    const { displayCurrency, ...profile } = body;
    await container.registrations.register({
      ...profile,
      ...(displayCurrency === undefined ? {} : { displayCurrency }),
    });
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
