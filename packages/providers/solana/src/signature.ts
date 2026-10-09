import type { SignatureVerifier } from "@mayarin/wallet";
import { ed25519 } from "@noble/curves/ed25519";
import { PublicKey } from "@solana/web3.js";

/** Ed25519 message verification for Phantom and other Solana wallets. */
export class SolanaSignatureVerifier implements SignatureVerifier {
  async verify(input: Parameters<SignatureVerifier["verify"]>[0]): Promise<boolean> {
    if (!input.chain.startsWith("solana-")) return false;
    const signature = Uint8Array.from(Buffer.from(input.signature, "base64"));
    if (signature.length !== 64) return false;
    const address = new PublicKey(input.address);
    return ed25519.verify(signature, new TextEncoder().encode(input.message), address.toBytes());
  }
}
