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

/** POST `/auth/logout` response. */
export interface LogoutResponse {
  readonly ok: boolean;
}

/** POST `/auth/register` request body. No settlement address: Settings owns that. */
export interface RegisterRequest {
  readonly email: string;
  readonly password: string;
  readonly merchantName: string;
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
