/**
 * Permissions.
 *
 * A flat flag set replaces the old exclusive `Role` union. Every account is a
 * merchant account; permissions gate which surfaces within that merchant the
 * account can reach. `users:manage` lets a merchant-admin grant permissions to
 * other accounts in the same merchant — never cross-merchant.
 *
 * A total table keyed by `Permission` keeps the compiler enforcing totality:
 * adding a permission is an error at every table rather than a silent
 * fallthrough.
 */

export type Permission = "payments:read" | "users:manage" | "admin:access" | "settings:manage";

export const PERMISSION_LIST: readonly Permission[] = [
  "payments:read",
  "users:manage",
  "admin:access",
  "settings:manage",
];

/** Human labels, exhaustive by construction. */
export const PERMISSION_LABELS: Readonly<Record<Permission, string>> = {
  "payments:read": "View payments",
  "users:manage": "Manage users",
  "admin:access": "Admin dashboard",
  // Its own permission rather than folded into `admin:access`: this one decides
  // where the merchant's money is paid, and an account that reads payments and
  // manages users has no business redirecting them.
  "settings:manage": "Change settlement settings",
} as const;

export function isPermission(value: unknown): value is Permission {
  return PERMISSION_LIST.includes(value as Permission);
}

/** Default permissions for the first account on a freshly seeded merchant. */
export const MERCHANT_ADMIN_PERMISSIONS: readonly Permission[] = [
  "payments:read",
  "users:manage",
  "admin:access",
  "settings:manage",
];
