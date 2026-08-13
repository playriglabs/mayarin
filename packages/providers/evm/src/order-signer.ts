/**
 * Local development order signer (RFC #6 — #41).
 *
 * **Not for production.** The private key is held in this process, so anything
 * that can read the process can authorize settlement amounts. Production signing
 * goes through AWS KMS, where the key remains non-exportable and IAM gates each
 * signature — see `docs/quote-signing.md`.
 *
 * This exists so a developer can run the quote path end to end without Turnkey
 * credentials. The composition root must refuse to wire it outside development;
 * that check lives there rather than here, because only the composition root
 * knows which environment it is building for.
 */

import type { Hex, OrderSigner, OrderTypedData } from "@mayarin/quote";
import { privateKeyToAccount } from "viem/accounts";

export class LocalOrderSigner implements OrderSigner {
  readonly #account: ReturnType<typeof privateKeyToAccount>;

  constructor(privateKey: Hex) {
    this.#account = privateKeyToAccount(privateKey);
  }

  async address(): Promise<Hex> {
    return this.#account.address;
  }

  async sign(typedData: OrderTypedData): Promise<Hex> {
    // viem's typed-data signing produces the same digest the contract's
    // `_hashTypedDataV4` builds, which the order-hash vectors pin.
    return this.#account.signTypedData({
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    });
  }
}
