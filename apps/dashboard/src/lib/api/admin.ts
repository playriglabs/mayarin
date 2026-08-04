/**
 * Admin API — requests for the within-merchant admin surface. Mirrors
 * `/admin/*` on the dashboard API. Returns `Effect`s; never calls `fetch`
 * directly. POST is CSRF-guarded server-side; the centralized client auto-
 * attaches the double-submit token.
 */

import type { Effect } from "effect";
import { type ApiError, request } from "@/lib/api/client";
import type { AdminUsersResponse, CreateUserRequest, CreateUserResponse } from "@/types/admin";

export const adminApi = {
  /** GET `/admin/users` — the caller's own merchant accounts. */
  listUsers: (): Effect.Effect<AdminUsersResponse, ApiError> =>
    request<AdminUsersResponse>("/admin/users"),

  /** POST `/admin/users` — grant a sub-account in the caller's merchant. */
  createUser: (body: CreateUserRequest): Effect.Effect<CreateUserResponse, ApiError> =>
    request<CreateUserResponse>("/admin/users", { method: "POST", body }),
};
