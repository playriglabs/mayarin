/** Admin surface types — manage accounts within the caller's own merchant. */

import type { Permission, UserDto } from "./user";

/** GET `/admin/users` — the accounts in the caller's merchant. */
export interface AdminUsersResponse {
  readonly users: readonly UserDto[];
}

/** POST `/admin/users` request body. `password` omitted = server generates one. */
export interface CreateUserRequest {
  readonly email: string;
  readonly password?: string;
  readonly permissions: readonly Permission[];
}

/** POST `/admin/users` response — the new account + the generated password, if any. */
export interface CreateUserResponse {
  readonly user: UserDto;
  readonly generatedPassword?: string;
}
