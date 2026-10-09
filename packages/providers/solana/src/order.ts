import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519";
import { PublicKey } from "@solana/web3.js";

const ORDER_PREFIX = new TextEncoder().encode("MAYARIN_PAYMENT_ORDER_V1");

export interface SolanaOrder {
  readonly intentId: Uint8Array;
  readonly settlementMint: string;
  readonly minOut: bigint;
  readonly fee: bigint;
  readonly merchant: string;
  readonly refundTo: string;
  readonly deadline: bigint;
}

export interface SolanaOrderSigner {
  publicKey(): string;
  sign(message: Uint8Array): Promise<Uint8Array>;
}

function fixedBytes(value: Uint8Array, length: number, name: string): Uint8Array {
  if (value.length !== length) throw new Error(`${name} must be ${length} bytes`);
  return value;
}

function writeU64(value: bigint): Uint8Array {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) throw new Error("u64 is out of range");
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}

function writeI64(value: bigint): Uint8Array {
  if (value < -0x8000_0000_0000_0000n || value > 0x7fff_ffff_ffff_ffffn) {
    throw new Error("i64 is out of range");
  }
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigInt64(0, value, true);
  return bytes;
}

function join(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export function encodeSolanaOrder(order: SolanaOrder): Uint8Array {
  return join([
    fixedBytes(order.intentId, 32, "intentId"),
    new PublicKey(order.settlementMint).toBytes(),
    writeU64(order.minOut),
    writeU64(order.fee),
    new PublicKey(order.merchant).toBytes(),
    new PublicKey(order.refundTo).toBytes(),
    writeI64(order.deadline),
  ]);
}

export function encodeSolanaOrderMessage(input: {
  readonly programId: string;
  readonly config: string;
  readonly deploymentDomain: Uint8Array;
  readonly order: SolanaOrder;
}): Uint8Array {
  return join([
    ORDER_PREFIX,
    new PublicKey(input.programId).toBytes(),
    new PublicKey(input.config).toBytes(),
    fixedBytes(input.deploymentDomain, 32, "deploymentDomain"),
    encodeSolanaOrder(input.order),
  ]);
}

export function deriveSolanaIntentId(clearingTransactionId: string): Uint8Array {
  return createHash("sha256").update(clearingTransactionId, "utf8").digest();
}

export function intentIdToHex(intentId: Uint8Array): string {
  return `0x${Buffer.from(fixedBytes(intentId, 32, "intentId")).toString("hex")}`;
}

export function intentIdFromHex(value: string): Uint8Array {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error("intentId must be 32-byte hex");
  return Uint8Array.from(Buffer.from(value.slice(2), "hex"));
}

export class LocalSolanaOrderSigner implements SolanaOrderSigner {
  readonly #secretKey: Uint8Array;
  readonly #publicKey: string;

  constructor(secretKey: Uint8Array) {
    if (secretKey.length !== 32 && secretKey.length !== 64) {
      throw new Error("Solana signer secret key must be 32 or 64 bytes");
    }
    this.#secretKey = secretKey.slice(0, 32);
    const publicKey = ed25519.getPublicKey(this.#secretKey);
    if (
      secretKey.length === 64 &&
      !Buffer.from(publicKey).equals(Buffer.from(secretKey.slice(32)))
    ) {
      throw new Error("Solana signer secret key contains a mismatched public key");
    }
    this.#publicKey = new PublicKey(publicKey).toBase58();
  }

  publicKey(): string {
    return this.#publicKey;
  }

  async sign(message: Uint8Array): Promise<Uint8Array> {
    return ed25519.sign(message, this.#secretKey);
  }
}
