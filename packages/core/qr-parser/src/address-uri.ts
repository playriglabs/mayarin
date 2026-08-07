/**
 * EIP-681 address URI encoding — the write direction of the parser.
 *
 * The rest of this package decodes a merchant's QR. This encodes the payer's:
 * Mayarin writes an address URI, renders it as a QR, and any wallet that can
 * scan one reads a prefilled send screen from it.
 *
 * **Why an address URI and not a call.** A wallet that scans a QR does exactly
 * one thing with it — a plain transfer. It does not assemble calldata, attach a
 * backend signature, or call a contract function. That is not a limitation to
 * work around; it is the reason the deposit-address path exists, and it is what
 * makes the path work with every wallet and every custodial exchange withdrawal
 * without a single per-wallet integration. A URI that a wallet cannot read is
 * worse than no URI, so this encoder emits only the two forms wallets actually
 * support.
 *
 * The two forms, and they are not interchangeable:
 *
 * ```
 * native   ethereum:0xRECIPIENT@8453?value=1000000000000000
 * ERC-20   ethereum:0xTOKEN@8453/transfer?address=0xRECIPIENT&uint256=3000000
 * ```
 *
 * For an ERC-20 the URI target is the **token** contract and the recipient is
 * an argument, because the transfer is a call on the token. Putting the
 * recipient in the target position instead produces a URI that sends native
 * value to a token contract — a wallet will happily do it, and the funds are
 * gone. The shapes are kept apart here so no caller can pick the wrong one.
 *
 * `Money.amount` is already an integer count of the asset's minor units, which
 * is what both `value` and `uint256` want, so nothing is converted or scaled.
 * This holds only while the registry's decimals match the deployed token's —
 * a mismatch would misstate the amount, so a new on-chain identity must be
 * checked against the contract, not assumed.
 */

import { type Money, ValidationError } from "@mayarin/shared";

/** A 40-hex-digit, `0x`-prefixed EVM address. */
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export interface AddressUriRequest {
  /** Who receives the value — the per-intent deposit address. */
  readonly recipient: string;
  /** EIP-155 numeric chain id, e.g. `84532n` for Base Sepolia. */
  readonly chainId: bigint;
  /** How much, in the asset's minor units. */
  readonly amount: Money;
  /**
   * The ERC-20 contract the amount is denominated in. Omit for the chain's
   * native asset — the presence of this field is what selects the URI form.
   */
  readonly token?: string;
}

/**
 * Encodes a payment request as an EIP-681 URI.
 *
 * Throws rather than emitting a malformed URI: a QR is scanned by a stranger's
 * wallet with no way to report back, so a bad one fails silently as a lost
 * payment.
 */
export function encodeAddressUri(request: AddressUriRequest): string {
  const { recipient, chainId, amount, token } = request;

  assertAddress(recipient, "recipient");
  if (chainId <= 0n) {
    throw new ValidationError("An EIP-681 URI needs a positive chain id", {
      chainId: chainId.toString(),
    });
  }
  if (amount.amount <= 0n) {
    throw new ValidationError("An EIP-681 URI needs a positive amount", {
      amount: amount.amount.toString(),
      asset: amount.asset,
    });
  }

  if (token === undefined) {
    return `ethereum:${recipient}@${chainId}?value=${amount.amount}`;
  }

  assertAddress(token, "token");
  return `ethereum:${token}@${chainId}/transfer?address=${recipient}&uint256=${amount.amount}`;
}

function assertAddress(value: string, field: string): void {
  if (!ADDRESS_PATTERN.test(value)) {
    throw new ValidationError(`An EIP-681 URI needs a 0x-prefixed 20-byte ${field} address`, {
      [field]: value,
    });
  }
}
