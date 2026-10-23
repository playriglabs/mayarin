import { isAddress } from "viem";

const EVM_ADDRESS_SHAPE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Every 20-byte hex string in a config value whose mixed case is not its EIP-55
 * checksum.
 *
 * viem refuses such an address only when a payment first builds a route with it,
 * so a copy that lost a capital letter ran fine until a payer paid and then failed
 * that payment (`Address ... is invalid`). Checking at load turns it into a boot
 * failure, or a rejected write when an operator changes the runtime config.
 */
export function badChecksumAddresses(value: unknown): string[] {
  if (typeof value === "string") {
    return EVM_ADDRESS_SHAPE.test(value) && !isAddress(value) ? [value] : [];
  }
  if (Array.isArray(value)) return value.flatMap(badChecksumAddresses);
  if (value !== null && typeof value === "object") {
    return Object.values(value).flatMap(badChecksumAddresses);
  }
  return [];
}
