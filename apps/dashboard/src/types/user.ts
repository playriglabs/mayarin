/** Authenticated user shape, mirrored from the dashboard API `/auth/me`. */

/**
 * Permission flags an account carries within its merchant. Mirrors
 * `@mayarin/auth` `Permission`. A flat flag set — there is no exclusive role;
 * every account is merchant-scoped, and `permissions` gates which surfaces it
 * can reach within that merchant.
 */
export type Permission =
  | "payments:read"
  | "users:manage"
  | "admin:access"
  | "settings:manage"
  | "catalog:manage";

export const PERMISSION_LIST = [
  "payments:read",
  "users:manage",
  "admin:access",
  "settings:manage",
  "catalog:manage",
] as const;

/**
 * Human labels, exhaustive by construction — the same table
 * `@mayarin/auth` keeps server-side.
 *
 * Here rather than in each component because two copies drifted once already:
 * the granting form offered three of the permissions the API accepts, so a
 * merchant-admin could not grant the other two from the dashboard at all.
 * `Record<Permission, string>` makes adding a permission a compile error here
 * instead of a silently missing checkbox there.
 */
export const PERMISSION_LABELS: Readonly<Record<Permission, string>> = {
  "payments:read": "View payments",
  "users:manage": "Manage users",
  "admin:access": "Admin dashboard",
  "settings:manage": "Change settlement settings",
  "catalog:manage": "Manage products and payment links",
} as const;

export interface UserDto {
  readonly id: string;
  readonly email: string;
  readonly merchantId: string;
  readonly permissions: readonly Permission[];
}

/** `/auth/me` response: `user` is `null` when unauthenticated. */
export interface MeResponse {
  readonly user: UserDto | null;
}
