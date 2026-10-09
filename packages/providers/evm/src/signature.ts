/**
 * EIP-191 signature recovery (#11).
 *
 * The one piece of wallet verification that touches cryptography, and therefore
 * the one piece that lives outside `core`. `recoverMessageAddress` implements
 * the personal-sign scheme every wallet exposes, which is what a merchant can
 * actually produce from MetaMask, a Safe UI or a hardware device.
 */

import type { SignatureVerifier } from "@mayarin/wallet";
import { recoverMessageAddress } from "viem";

export class ViemSignatureVerifier implements SignatureVerifier {
  async verify(input: Parameters<SignatureVerifier["verify"]>[0]): Promise<boolean> {
    const address = await recoverMessageAddress({
      message: input.message,
      signature: input.signature as `0x${string}`,
    });
    return address.toLowerCase() === input.address.toLowerCase();
  }
}
