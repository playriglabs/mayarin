import type { UserDto } from "./user";

/** POST `/auth/login` request body. */
export interface LoginRequest {
  readonly email: string;
  readonly password: string;
}

/** POST `/auth/login` response — the freshly authenticated user. */
export interface AuthResponse {
  readonly user: UserDto;
}

/** The password was right and a second factor is owed; no session exists yet. */
export interface MfaChallengeResponse {
  readonly mfaRequired: true;
  readonly challenge: string;
}

export type LoginResponse = AuthResponse | MfaChallengeResponse;

export function isMfaChallenge(response: LoginResponse): response is MfaChallengeResponse {
  return "mfaRequired" in response;
}

/** POST `/auth/login/mfa` request body. */
export interface MfaLoginRequest {
  readonly challenge: string;
  readonly code: string;
}

/** POST `/auth/mfa/setup` response: what an authenticator app needs. */
export interface MfaSetupResponse {
  readonly secret: string;
  readonly otpauthUri: string;
  /** SVG markup of the QR. Shown through an `<img>`, never injected as HTML. */
  readonly qrSvg: string;
}

export interface MfaVerifyResponse {
  readonly enabled: true;
  readonly recoveryCodes: readonly string[];
}

export interface MfaCodeRequest {
  readonly code: string;
}

/** POST `/auth/logout` response. */
export interface LogoutResponse {
  readonly ok: boolean;
}

/** POST `/auth/register` request body. No settlement address: Settings owns that. */
export interface RegisterRequest {
  readonly email: string;
  readonly password: string;
  readonly merchantName: string;
  readonly city: string;
  readonly countryCode: string;
}

/** POST `/auth/verify-email` request body. */
export interface VerifyEmailRequest {
  readonly email: string;
  readonly code: string;
}

/** POST `/auth/resend-verification` request body. */
export interface ResendVerificationRequest {
  readonly email: string;
}

/** What the three unauthenticated auth endpoints answer with. They say nothing else. */
export interface OkResponse {
  readonly ok: boolean;
}

/** POST `/auth/password/change` request body. `code` is owed when a second factor is on. */
export interface ChangePasswordRequest {
  readonly currentPassword: string;
  readonly newPassword: string;
  readonly code?: string;
}

/** POST `/auth/password/forgot` request body. */
export interface ForgotPasswordRequest {
  readonly email: string;
}

/** POST `/auth/password/reset` request body. `mfaCode` is owed when a second factor is on. */
export interface ResetPasswordRequest {
  readonly email: string;
  readonly code: string;
  readonly newPassword: string;
  readonly mfaCode?: string;
}
