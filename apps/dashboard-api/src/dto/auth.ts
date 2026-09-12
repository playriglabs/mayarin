/**
 * Auth DTOs and cookie/scope shaping.
 *
 * Pure: zod request schemas, response DTO interfaces, and the pure helpers that
 * turn a `User` into a wire shape and a scope. Cookie option builders live here
 * too so the routes stay thin — the only cookie concern a route has is "set" or
 * "clear". No Hono, no Drizzle.
 */

import type { Permission, User } from "@mayarin/auth";
import { isPermission, PERMISSION_LIST } from "@mayarin/auth";
import type { CookieOptions } from "hono/utils/cookie";
import { z } from "zod";

export const SESSION_COOKIE = "mayarin_session";
export const CSRF_COOKIE = "mayarin_csrf";
export const CSRF_HEADER = "x-csrf-token";

/**
 * What a session bearer is allowed to see. Every account is merchant-scoped:
 * `merchantId` is the payments scope key, `permissions` gates which surfaces
 * within that merchant the account can reach. There is no cross-merchant view.
 */
export interface Scope {
  readonly merchantId: string;
  readonly permissions: ReadonlySet<Permission>;
}

/** The visibility/permission context for a logged-in user. */
export function scopeOf(user: User): Scope {
  return { merchantId: user.merchantId, permissions: new Set(user.permissions) };
}

/** Whether the scope carries the given permission. */
export function can(scope: Scope, permission: Permission): boolean {
  return scope.permissions.has(permission);
}

export interface UserDto {
  readonly id: string;
  readonly email: string;
  readonly merchantId: string;
  readonly permissions: readonly Permission[];
}

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    merchantId: user.merchantId,
    permissions: [...user.permissions],
  };
}

export const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginBody = z.infer<typeof loginBodySchema>;

/**
 * Self-registration's whole input.
 *
 * No settlement address and no chain: what a merchant is paid into is a
 * decision they make inside the dashboard, on a surface that can explain it,
 * not on a signup form. The password floor is a length rather than a character
 * class — length is what actually resists a guess, and composition rules mostly
 * produce `Passw0rd!`.
 */
export const registerBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(12).max(200),
  merchantName: z.string().trim().min(1).max(120),
});

export const verifyEmailBodySchema = z.object({
  email: z.string().email(),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "A code is six digits"),
});

export const resendVerificationBodySchema = z.object({ email: z.string().email() });

/**
 * Zod refinement over the `Permission` union; rejects unknown flags.
 *
 * Built off `PERMISSION_LIST` so a new permission lands here the moment it is
 * added — a hand-maintained subset here would silently reject `settings:manage`
 * and `catalog:manage` (which it once did), freezing every newer surface out of
 * the user-create body and the API-key create body alike.
 */
const permissionSchema = z.enum(PERMISSION_LIST as [Permission, ...Permission[]]);
export const permissionsSchema = z.array(permissionSchema);

/** Body for `POST /admin/users` — create a sub-account in the caller's merchant. */
export const createUserBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(12).optional(),
  permissions: permissionsSchema,
});
export type CreateUserBody = z.infer<typeof createUserBodySchema>;

/** Refinement helper exported for tests/CLI reuse. */
export function parsePermissions(values: readonly string[]): Permission[] {
  for (const value of values) {
    if (!isPermission(value)) throw new RangeError(`Unknown permission: ${value}`);
  }
  return [...values] as Permission[];
}

/** `httpOnly` session cookie: the browser carries it but never reads it. */
export function sessionCookieOptions(ttlSeconds: number, secure: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: "Strict",
    path: "/",
    maxAge: ttlSeconds,
  };
}

/**
 * CSRF cookie: NOT `httpOnly`, so the browser JS can read it to echo the
 * double-submit token back on mutating requests. SameSite=Strict is the primary
 * defence; this is defence-in-depth.
 */
export function csrfCookieOptions(ttlSeconds: number, secure: boolean): CookieOptions {
  return {
    httpOnly: false,
    secure,
    sameSite: "Strict",
    path: "/",
    maxAge: ttlSeconds,
  };
}

/** Cookie options that immediately expire the cookie on the client. */
export function clearCookieOptions(secure: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: "Strict",
    path: "/",
    maxAge: 0,
  };
}
