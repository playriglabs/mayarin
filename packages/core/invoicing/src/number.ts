/**
 * Invoice numbering.
 *
 * Two halves, split on purpose. Allocating a counter value is the one part of
 * invoicing that cannot be pure, because it has to agree with every other
 * issuance for the same merchant — that lives behind `InvoiceNumberAllocator`.
 * Turning a counter value into the string a buyer files is arithmetic on a
 * string, and lives here.
 *
 * The split is what lets the open question about gapless numbering stay open.
 * A gapless allocator takes a row lock per merchant; a gap-tolerant one uses a
 * sequence and costs nothing. Both satisfy the port, so the decision changes an
 * adapter and never reaches the domain, the service or a test.
 */

import { ValidationError } from "@mayarin/shared";

/** Digits the counter is padded to, so numbers sort as text and read as a series. */
const SEQUENCE_DIGITS = 4;

export interface InvoiceNumberFormat {
  /** Merchant's own prefix, for example `INV`. */
  readonly prefix?: string;
  /**
   * Whether the issue year is part of the number. Most Indonesian merchants
   * restart a series each year, and a number without a year cannot express that.
   */
  readonly includeYear?: boolean;
}

/**
 * Renders an allocated counter value as the number the buyer sees.
 *
 * `INV/2026/0001` by default with a prefix and a year, `0001` with neither.
 * The separator is a solidus rather than a hyphen because that is what an
 * Indonesian invoice conventionally uses.
 */
export function formatInvoiceNumber(
  sequence: number,
  issuedAt: Date,
  format: InvoiceNumberFormat = {},
): string {
  if (!Number.isInteger(sequence) || sequence <= 0) {
    throw new ValidationError("An invoice sequence must be a positive integer", { sequence });
  }

  const parts: string[] = [];
  const prefix = format.prefix?.trim();
  if (prefix !== undefined && prefix !== "") parts.push(prefix);
  if (format.includeYear === true) parts.push(String(issuedAt.getUTCFullYear()));
  parts.push(String(sequence).padStart(SEQUENCE_DIGITS, "0"));

  return parts.join("/");
}
