/**
 * Reference in-memory order signer, in the segregated `/testing` subpath so
 * domain `src/` stays pure. The signature is deterministic and fake — the
 * intent id, padding, and a `v` byte — so a test can assert plumbing without
 * any key material. Real signing lives in the signer adapter (#41).
 */

import type { Hex, OrderSigner, OrderTypedData } from "../src/index.ts";

export class FakeOrderSigner implements OrderSigner {
  readonly calls: OrderTypedData[] = [];
  readonly #address: Hex;

  constructor(address: Hex = "0x00000000000000000000000000000000000000a1") {
    this.#address = address;
  }

  async address(): Promise<Hex> {
    return this.#address;
  }

  async sign(typedData: OrderTypedData): Promise<Hex> {
    this.calls.push(typedData);
    return `0x${typedData.message.intentId.slice(2)}${"00".repeat(32)}1b`;
  }
}
