/**
 * Astro server middleware.
 *
 * Runs before every page: reads the `mayarin_session` cookie, asks the dashboard
 * API for the authoritative user (`/auth/me` via the server-side base URL), and
 * stamps it on `locals.user`. A missing/expired cookie leaves `locals.user`
 * undefined.
 *
 * Auth gating lives here, not in the layouts: a logged-in user hitting `/login`
 * bounces to `/`; an anonymous user hitting a protected path bounces to `/login`.
 * Doing it in middleware keeps the redirect ahead of any island SSR, so a
 * provider crash during render can never swallow the redirect (the
 * `ResponseSentError` we hit when gating lived in the layout).
 *
 * The API is called server-to-server, not through the browser proxy, so SSR
 * does not depend on the browser's cookie jar beyond the one read here.
 */

import { defineMiddleware } from "astro:middleware";
import { getApiBase } from "@/lib/api/origin";
import type { Permission, UserDto } from "@/types/user";

const PROTECTED_PREFIXES = [
  "/payments",
  "/orders",
  "/customers",
  "/links",
  "/catalog",
  "/settlement",
  "/analytics",
  "/wallets",
  "/webhooks",
  "/api-keys",
  "/event-logs",
  "/settings",
  "/admin",
];
const PROTECTED_EXACT = new Set(["/"]);
const LOGIN_PATH = "/login";
/**
 * Paths that, beyond authentication, require a specific permission.
 *
 * Every authenticated surface belongs here, not only the admin one: the backend
 * refuses without the permission either way, so a page left out is a page that
 * renders its chrome and then an error alert. `/settlement` is deliberately
 * absent — it needs `payments:read`, which every account that can sign in has.
 */
const PERMISSION_PREFIXES: ReadonlyArray<readonly [string, Permission]> = [
  ["/admin", "admin:access"],
  ["/links", "catalog:manage"],
  ["/catalog", "catalog:manage"],
  ["/customers", "catalog:manage"],
  ["/wallets", "settings:manage"],
  ["/webhooks", "settings:manage"],
  ["/api-keys", "settings:manage"],
  ["/settings", "settings:manage"],
];

export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.user = undefined;

  const cookie = context.cookies.get("mayarin_session")?.value;
  if (cookie !== undefined && cookie !== "") {
    try {
      const res = await fetch(`${getApiBase()}/auth/me`, {
        headers: { cookie: `mayarin_session=${cookie}` },
      });
      if (res.ok) {
        const body = (await res.json()) as { user: UserDto | null };
        if (body.user !== null) context.locals.user = body.user;
      }
    } catch {
      // An unreachable API during SSR is not a page failure: fall through to the
      // redirect below, so the user sees /login rather than a crash.
    }
  }

  const path = context.url.pathname;
  const authenticated = context.locals.user !== undefined;

  const isProtected =
    PROTECTED_EXACT.has(path) || PROTECTED_PREFIXES.some((p) => path.startsWith(p));

  if (authenticated && path === LOGIN_PATH) return context.redirect("/");
  if (!authenticated && isProtected) return context.redirect("/login");

  // Permission gate: a caller authenticated but lacking the permission a path
  // requires is bounced to the dashboard rather than shown a 403 page. The
  // backend enforces the same gate per-request; this just avoids a dead UI.
  if (authenticated) {
    const user = context.locals.user;
    const missing = PERMISSION_PREFIXES.find(
      ([prefix, perm]) =>
        path.startsWith(prefix) && user !== undefined && !user.permissions.includes(perm),
    );
    if (missing !== undefined) return context.redirect("/");
  }

  return next();
});
