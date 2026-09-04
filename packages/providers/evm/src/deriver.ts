/**
 * HD deposit address derivation.
 *
 * Constructed from an extended *public* key, so this class cannot produce a
 * private key even in principle: a bug here cannot move funds, because the
 * process holds nothing to move them with. Signing belongs to the Settlement
 * Engine, with its own custody.
 */

import type { DepositAddressDeriver } from "@mayarin/chain";
import { ConfigurationError } from "@mayarin/shared";
import { secp256k1 } from "@noble/curves/secp256k1";
import { HDKey } from "viem/accounts";
import { publicKeyToAddress } from "viem/utils";

export interface HdDepositAddressDeriverOptions {
  /** Extended public key for the branch addresses are derived under. */
  readonly xpub: string;
}

export class HdDepositAddressDeriver implements DepositAddressDeriver {
  readonly #branch: HDKey;

  constructor(options: HdDepositAddressDeriverOptions) {
    try {
      this.#branch = HDKey.fromExtendedKey(options.xpub);
    } catch (error) {
      throw new ConfigurationError(
        "DEPOSIT_XPUB is not a valid extended public key",
        {},
        { cause: error },
      );
    }
  }

  /**
   * The chain is ignored, and that is correct here rather than an oversight: an
   * address derived from a public key is the same on every EVM chain, because
   * nothing about the derivation names one.
   */
  derive(index: number): string {
    if (!Number.isInteger(index) || index < 0) {
      throw new ConfigurationError(
        `Derivation index must be a non-negative integer, got ${index}`,
        { index },
      );
    }

    const child = this.#branch.deriveChild(index);
    const compressed = child.publicKey;
    if (compressed === null) {
      throw new ConfigurationError(`Could not derive a public key at index ${index}`, { index });
    }

    // `publicKeyToAddress` hashes the uncompressed point, but HDKey stores only
    // the compressed form, so the point is expanded through the curve first.
    const point = secp256k1.ProjectivePoint.fromHex(compressed);
    const uncompressed = point.toRawBytes(false); // 0x04 || X || Y
    return publicKeyToAddress(`0x${Buffer.from(uncompressed).toString("hex")}`).toLowerCase();
  }
}
