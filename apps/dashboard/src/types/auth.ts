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
