/// <reference path="../.astro/types.d.ts" />

type UserDto = import("./types/user").UserDto;

declare namespace App {
  interface Locals {
    /** The authenticated user, or `undefined` when no live session cookie is present. */
    user: UserDto | undefined;
  }
}
