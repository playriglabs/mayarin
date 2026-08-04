/**
 * Argon2id password hasher.
 *
 * The concrete adapter for the `PasswordHasher` port in `@mayarin/auth`. Lives
 * outside core per ports-and-adapters: a domain package imports the port, the
 * composition root wires this adapter.
 *
 * Parameters are the OWASP baseline (m = 19456 KiB, t = 2, p = 1) for argon2id.
 * `@node-rs/argon2` ships prebuilt native binaries, so no compile toolchain is
 * required in CI.
 */

import type { PasswordHasher } from "@mayarin/auth";
import { hash, verify } from "@node-rs/argon2";

export interface Argon2PasswordHasherOptions {
  /** Memory cost in KiB. Default 19456 (19 MiB) — OWASP baseline. */
  readonly memoryCost?: number;
  /** Time cost (iterations). Default 2 — OWASP baseline. */
  readonly timeCost?: number;
  /** Parallelism (lanes). Default 1. */
  readonly parallelism?: number;
}

export class Argon2PasswordHasher implements PasswordHasher {
  readonly #memoryCost: number;
  readonly #timeCost: number;
  readonly #parallelism: number;

  constructor(options: Argon2PasswordHasherOptions = {}) {
    this.#memoryCost = options.memoryCost ?? 19_456;
    this.#timeCost = options.timeCost ?? 2;
    this.#parallelism = options.parallelism ?? 1;
  }

  async hash(plain: string): Promise<string> {
    // Argon2id is @node-rs/argon2's default algorithm, so it is not named
    // here: `Algorithm` is a const enum, which `verbatimModuleSyntax` forbids
    // importing. The default produces `$argon2id$` digests.
    return hash(plain, {
      memoryCost: this.#memoryCost,
      timeCost: this.#timeCost,
      parallelism: this.#parallelism,
    });
  }

  async verify(plain: string, hashed: string): Promise<boolean> {
    return verify(hashed, plain);
  }
}
