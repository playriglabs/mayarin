/**
 * CREATE2 deposit address derivation (RFC #69).
 *
 * The second implementation of `DepositAddressDeriver`, alongside the HD one.
 * Both answer the same question — what address does this payment deposit to —
 * and neither holds anything that can spend from the result.
 *
 * The difference is what sits at the address. An HD-derived EOA receives exactly
 * the quoted amount and therefore cannot pay the gas to move it, which is what
 * left the deposit path unable to settle. A CREATE2 address is a counterfactual
 * contract: the payer sends to it before any code exists, and the operator later
 * deploys the forwarder and sweeps in one transaction it pays for itself.
 *
 * The address is a pure function of `(factory, salt, initCodeHash)`, so it is
 * derivable with no key, no transaction, and no network call — the same property
 * the xpub gave, arrived at differently.
 */

import type { DepositAddressDeriver } from "@mayarin/chain";
import { ConfigurationError } from "@mayarin/shared";
import { getAddress, getCreate2Address, isAddress, isHex, keccak256, toHex } from "viem";

export interface Create2DepositAddressDeriverOptions {
  /** Deployed `DepositForwarderFactory`. Part of the CREATE2 preimage. */
  readonly factory: string;
  /**
   * `keccak256(type(DepositForwarder).creationCode)`.
   *
   * Configuration rather than a constant compiled in here: it changes whenever
   * the forwarder's bytecode changes, and a stale constant would derive
   * addresses the deployed factory can never deploy to — payers would send to
   * addresses that nothing can sweep. `DepositForwarderFactory.INIT_CODE_HASH()`
   * is the authority, and the composition root checks this against it at boot.
   */
  readonly initCodeHash: string;
}

/**
 * Salt for a deposit index.
 *
 * `keccak256` of the index rather than the index padded into 32 bytes: a
 * left-padded integer salt makes the low bits of every deposit address
 * derivable from a small counter, so an observer who learns one address learns
 * the shape of the next. Hashing costs nothing and removes the pattern.
 */
export function depositSalt(index: number): `0x${string}` {
  return keccak256(toHex(`mayarin.deposit.${index}`));
}

export class Create2DepositAddressDeriver implements DepositAddressDeriver {
  readonly #factory: `0x${string}`;
  readonly #initCodeHash: `0x${string}`;

  constructor(options: Create2DepositAddressDeriverOptions) {
    if (!isAddress(options.factory)) {
      throw new ConfigurationError("DEPOSIT_FORWARDER_FACTORY is not a valid address", {
        factory: options.factory,
      });
    }

    if (!isHex(options.initCodeHash) || options.initCodeHash.length !== 66) {
      throw new ConfigurationError(
        "DEPOSIT_FORWARDER_INIT_CODE_HASH must be a 32-byte hex string",
        { initCodeHash: options.initCodeHash },
      );
    }

    this.#factory = getAddress(options.factory);
    this.#initCodeHash = options.initCodeHash;
  }

  derive(index: number): string {
    if (!Number.isInteger(index) || index < 0) {
      throw new ConfigurationError(
        `Derivation index must be a non-negative integer, got ${index}`,
        { index },
      );
    }

    return getCreate2Address({
      from: this.#factory,
      salt: depositSalt(index),
      bytecodeHash: this.#initCodeHash,
    });
  }
}
