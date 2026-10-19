/**
 * Auth API — requests for the auth domain ONLY. Mirrors `/auth/*` on the
 * dashboard API. Returns `Effect`s; never calls `fetch` directly.
 */

import { Effect } from "effect";
import { type ApiError, request } from "@/lib/api/client";
import type {
  ChangePasswordRequest,
  ForgotPasswordRequest,
  LoginRequest,
  LoginResponse,
  LogoutResponse,
  MfaCodeRequest,
  MfaLoginRequest,
  MfaSetupResponse,
  MfaVerifyResponse,
  OkResponse,
  RegisterRequest,
  ResendVerificationRequest,
  ResetPasswordRequest,
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
  login: (body: LoginRequest): Effect.Effect<LoginResponse, ApiError> =>
    request<LoginResponse>("/auth/login", { method: "POST", body }),

  /** POST `/auth/login/mfa` — the code step, redeeming the challenge. */
  loginMfa: (body: MfaLoginRequest): Effect.Effect<{ user: UserDto }, ApiError> =>
    request<{ user: UserDto }>("/auth/login/mfa", { method: "POST", body }),

  /** POST `/auth/mfa/setup` — a fresh secret and QR to scan. */
  mfaSetup: (): Effect.Effect<MfaSetupResponse, ApiError> =>
    request<MfaSetupResponse>("/auth/mfa/setup", { method: "POST", body: {} }),

  /** POST `/auth/mfa/verify` — confirms the app is reading the secret. */
  mfaVerify: (body: MfaCodeRequest): Effect.Effect<MfaVerifyResponse, ApiError> =>
    request<MfaVerifyResponse>("/auth/mfa/verify", { method: "POST", body }),

  /** POST `/auth/mfa/disable`. */
  mfaDisable: (body: MfaCodeRequest): Effect.Effect<{ enabled: false }, ApiError> =>
    request<{ enabled: false }>("/auth/mfa/disable", { method: "POST", body }),

  /** POST `/auth/register` — creates the merchant and sends a code. */
  register: (body: RegisterRequest): Effect.Effect<OkResponse, ApiError> =>
    request<OkResponse>("/auth/register", { method: "POST", body }),

  /** POST `/auth/verify-email` — redeems the code and unlocks sign-in. */
  verifyEmail: (body: VerifyEmailRequest): Effect.Effect<OkResponse, ApiError> =>
    request<OkResponse>("/auth/verify-email", { method: "POST", body }),

  /** POST `/auth/resend-verification` — issues a new code, retiring the last. */
  resendVerification: (body: ResendVerificationRequest): Effect.Effect<OkResponse, ApiError> =>
    request<OkResponse>("/auth/resend-verification", { method: "POST", body }),

  /** POST `/auth/password/change` — signs out every other device. */
  changePassword: (body: ChangePasswordRequest): Effect.Effect<OkResponse, ApiError> =>
    request<OkResponse>("/auth/password/change", { method: "POST", body }),

  /** POST `/auth/password/forgot` — emails a reset code; says nothing about the address. */
  forgotPassword: (body: ForgotPasswordRequest): Effect.Effect<OkResponse, ApiError> =>
    request<OkResponse>("/auth/password/forgot", { method: "POST", body }),

  /** POST `/auth/password/reset` — redeems the code; every device is signed out. */
  resetPassword: (body: ResetPasswordRequest): Effect.Effect<OkResponse, ApiError> =>
    request<OkResponse>("/auth/password/reset", { method: "POST", body }),

  /** POST `/auth/logout` (CSRF auto-attached by the client). */
  logout: (): Effect.Effect<LogoutResponse, ApiError> =>
    request<LogoutResponse>("/auth/logout", { method: "POST" }),
};
