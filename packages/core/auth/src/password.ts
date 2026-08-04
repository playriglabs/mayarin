/**
 * Password hashing port.
 *
 * Hashing is an effect, so per ports-and-adapters the port lives in core and the
 * concrete argon2 adapter lives outside it (`@mayarin/provider-argon2`).
 */

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, hashed: string): Promise<boolean>;
}
