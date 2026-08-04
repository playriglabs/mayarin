/**
 * Auth hooks — one React Query hook per `/auth/*` route.
 *
 * These are the ONLY auth surface components consume: `const login = useLogin();
 * login.mutate(body)`. Each hook fixes its query key and binds the matching
 * `authApi` call, so components never touch `useEffectMutation`/`useEffectQuery`
 * or the API module directly. Mirrors `lib/api/auth.ts` one-to-one.
 */

import { authApi } from "@/lib/api/auth";
import type { ApiError } from "@/lib/api/client";
import { useEffectMutation, useEffectQuery } from "@/lib/query";
import type { AuthResponse, LoginRequest, LogoutResponse } from "@/types/auth";
import type { UserDto } from "@/types/user";

/** POST `/auth/login`. `login.mutate({ email, password })`. */
export function useLogin() {
  return useEffectMutation<AuthResponse, LoginRequest, ApiError>({
    mutation: (body) => authApi.login(body),
  });
}

/** POST `/auth/logout` (CSRF auto-attached). `logout.mutate()`. */
export function useLogout() {
  return useEffectMutation<LogoutResponse, void, ApiError>({
    mutation: () => authApi.logout(),
  });
}

/** GET `/auth/me` — current user, or `null` when unauthenticated. */
export function useMe() {
  return useEffectQuery<UserDto | null, ApiError>({
    queryKey: ["auth", "me"],
    query: () => authApi.me(),
  });
}
