/**
 * Deterministic address deriver for tests.
 *
 * Distinct per index and stable across runs, which is all the watcher cares
 * about. The real BIP-32 derivation lives in `@mayarin/provider-evm`.
 */

import type { DepositAddressDeriver } from "@mayarin/chain";

export class FixedDepositAddressDeriver implements DepositAddressDeriver {
  derive(index: number): string {
    return `0x${index.toString(16).padStart(40, "0")}`;
  }
}
