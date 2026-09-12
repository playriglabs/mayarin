/**
 * Auth API — requests for the auth domain ONLY. Mirrors `/auth/*` on the
 * dashboard API. Returns `Effect`s; never calls `fetch` directly.
 */

import { Effect } from "effect";
import { type ApiError, request } from "@/lib/api/client";
import type {
  AuthResponse,
  LoginRequest,
  LogoutResponse,
  OkResponse,
  RegisterRequest,
  ResendVerificationRequest,
  VerifyEmailRequest,
} from "@/types/auth";
import type { MeResponse, UserDto } from "@/types/user";

export const authApi = {
  /** GET `/auth/me` -> current user, or `null` when unauthenticated (401). */
  me: (): Effect.Effect<UserDto | null, ApiError> =>
    request<MeResponse>("/auth/me").pipe(
      Effect.map((r) => r.user),
      Effect.catchIf(
        (e) => e.status === 401,
        () => Effect.succeed(null),
      ),
    ),

  /** POST `/auth/login`. */
  login: (body: LoginRequest): Effect.Effect<AuthResponse, ApiError> =>
    request<AuthResponse>("/auth/login", { method: "POST", body }),

  /** POST `/auth/register` — creates the merchant and sends a code. */
  register: (body: RegisterRequest): Effect.Effect<OkResponse, ApiError> =>
    request<OkResponse>("/auth/register", { method: "POST", body }),

  /** POST `/auth/verify-email` — redeems the code and unlocks sign-in. */
  verifyEmail: (body: VerifyEmailRequest): Effect.Effect<OkResponse, ApiError> =>
    request<OkResponse>("/auth/verify-email", { method: "POST", body }),

  /** POST `/auth/resend-verification` — issues a new code, retiring the last. */
  resendVerification: (body: ResendVerificationRequest): Effect.Effect<OkResponse, ApiError> =>
    request<OkResponse>("/auth/resend-verification", { method: "POST", body }),

  /** POST `/auth/logout` (CSRF auto-attached by the client). */
  logout: (): Effect.Effect<LogoutResponse, ApiError> =>
    request<LogoutResponse>("/auth/logout", { method: "POST" }),
};
