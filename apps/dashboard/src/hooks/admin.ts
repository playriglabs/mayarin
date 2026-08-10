/**
 * Admin hooks — one React Query hook per `/admin/*` route.
 *
 * Components consume `const users = useAdminUsers()` and `const create =
 * useCreateUser(); create.mutate(body)`. Mirrors `lib/api/admin.ts` one-to-one.
 */

import { adminApi } from "@/lib/api/admin";
import type { ApiError } from "@/lib/api/client";
import { useEffectMutation, useEffectQuery } from "@/lib/query";
import type { AdminUsersResponse, CreateUserRequest, CreateUserResponse } from "@/types/admin";

/** GET `/admin/users` — the caller's own merchant accounts. */
export function useAdminUsers() {
  return useEffectQuery<AdminUsersResponse, ApiError>({
    queryKey: ["admin", "users"],
    query: () => adminApi.listUsers(),
  });
}

/** POST `/admin/users` — grant a sub-account. `create.mutate(body)`. */
export function useCreateUser() {
  return useEffectMutation<CreateUserResponse, CreateUserRequest, ApiError>({
    mutation: (body) => adminApi.createUser(body),
    toast: { loading: "Creating account…", success: "Account created" },
  });
}
