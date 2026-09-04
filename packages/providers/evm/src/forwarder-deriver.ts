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

import type { ChainId, DepositAddressDeriver } from "@mayarin/chain";
import { ConfigurationError } from "@mayarin/shared";
import { getAddress, getCreate2Address, isAddress, isHex, keccak256, toHex } from "viem";

export interface Create2DepositAddressDeriverOptions {
  /** `DepositForwarderFactory` per chain. A chain with none cannot take deposits. */
  readonly factories: Readonly<Partial<Record<ChainId, string>>>;
  /** `INIT_CODE_HASH()` — one value, because the forwarder takes no constructor arguments. */
  readonly initCodeHash: string;
}

export function depositSalt(index: number): `0x${string}` {
  return keccak256(toHex(`mayarin.deposit.${index}`));
}

export class Create2DepositAddressDeriver implements DepositAddressDeriver {
  readonly #factories: Readonly<Partial<Record<ChainId, `0x${string}`>>>;
  readonly #initCodeHash: `0x${string}`;

  constructor(options: Create2DepositAddressDeriverOptions) {
    if (!isHex(options.initCodeHash) || options.initCodeHash.length !== 66) {
      throw new ConfigurationError(
        "DEPOSIT_FORWARDER_INIT_CODE_HASH must be a 32-byte hex string",
        { initCodeHash: options.initCodeHash },
      );
    }

    const factories: Partial<Record<ChainId, `0x${string}`>> = {};
    for (const [chain, factory] of Object.entries(options.factories)) {
      if (factory === undefined) continue;
      if (!isAddress(factory)) {
        throw new ConfigurationError(`DEPOSIT_FORWARDERS[${chain}] is not a valid address`, {
          chain,
          factory,
        });
      }
      factories[chain as ChainId] = getAddress(factory);
    }

    this.#factories = factories;
    this.#initCodeHash = options.initCodeHash;
  }

  /**
   * Per chain, because the factory is the CREATE2 deployer.
   *
   * One factory used for every chain derives an address the sweep on that chain
   * can never reach: the payer's funds arrive at an address only another
   * chain's factory could deploy to, the sweep deploys an empty forwarder at
   * the address it *can* reach and reports success, and the payment settles out
   * of the operator's own balance. Nothing fails; the money is simply somebody
   * else's.
   */
  derive(index: number, chain: ChainId): string {
    if (!Number.isInteger(index) || index < 0) {
      throw new ConfigurationError(
        `Derivation index must be a non-negative integer, got ${index}`,
        { index },
      );
    }

    const factory = this.#factories[chain];
    if (factory === undefined) {
      throw new ConfigurationError(
        `No DEPOSIT_FORWARDERS factory for ${chain}; a deposit address there could never be swept`,
        { chain, index },
      );
    }

    return getCreate2Address({
      from: factory,
      salt: depositSalt(index),
      bytecodeHash: this.#initCodeHash,
    });
  }
}
