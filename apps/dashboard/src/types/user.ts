/** Authenticated user shape, mirrored from the dashboard API `/auth/me`. */

/**
 * Permission flags an account carries within its merchant. Mirrors
 * `@mayarin/auth` `Permission`. A flat flag set — there is no exclusive role;
 * every account is merchant-scoped, and `permissions` gates which surfaces it
 * can reach within that merchant.
 */
export type Permission = "payments:read" | "users:manage" | "admin:access";

export const PERMISSION_LIST = ["payments:read", "users:manage", "admin:access"] as const;

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
