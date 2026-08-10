/**
 * Customer creation and edits.
 *
 * Pure functions over immutable values, mirroring `product.ts`: an edit returns
 * a new customer with a bumped `version`, which is the optimistic-locking token
 * the repository takes.
 */

import { generateId, ValidationError } from "@mayarin/shared";
import type { Customer } from "./types.ts";

export interface CreateCustomerInput {
  readonly merchantId: string;
  readonly name: string;
  readonly email?: string;
  readonly notes?: string;
  readonly now: Date;
}

export function createCustomer(input: CreateCustomerInput): Customer {
  assertName(input.name);
  if (input.email !== undefined) assertEmail(input.email);

  const createdAt = new Date(input.now);

  return {
    id: generateId("cus", createdAt.getTime()),
    merchantId: input.merchantId,
    name: input.name.trim(),
    ...(input.email === undefined ? {} : { email: input.email.trim() }),
    ...(input.notes === undefined || input.notes.trim() === ""
      ? {}
      : { notes: input.notes.trim() }),
    createdAt,
    updatedAt: createdAt,
    version: 1,
  };
}

export interface UpdateCustomerInput {
  readonly name?: string;
  /** `null` clears, an absent field leaves it alone — the same rule as a product's description. */
  readonly email?: string | null;
  readonly notes?: string | null;
}

export function updateCustomer(
  customer: Customer,
  patch: UpdateCustomerInput,
  now: Date,
): Customer {
  if (patch.name !== undefined) assertName(patch.name);
  if (patch.email !== undefined && patch.email !== null) assertEmail(patch.email);

  // Destructured away rather than spread over: `...customer` would carry the
  // existing email/notes through, so clearing either would leave it in place.
  const { email: _previousEmail, notes: _previousNotes, ...rest } = customer;
  const email = patch.email === undefined ? customer.email : patch.email;
  const notes = patch.notes === undefined ? customer.notes : patch.notes;

  return {
    ...rest,
    ...(patch.name === undefined ? {} : { name: patch.name.trim() }),
    ...(email === null || email === undefined || email.trim() === ""
      ? {}
      : { email: email.trim() }),
    ...(notes === null || notes === undefined || notes.trim() === ""
      ? {}
      : { notes: notes.trim() }),
    updatedAt: new Date(now),
    version: customer.version + 1,
  };
}

function assertName(name: string): void {
  if (name.trim() === "") {
    throw new ValidationError("A customer must have a name", {});
  }
}

function assertEmail(email: string): void {
  if (email.trim() === "") return;
  // A single @ with something on both sides is the honest floor. A regex that
  // pretends to know the full grammar would reject valid addresses and accept
  // invalid ones with equal confidence, and email validity is confirmed by
  // delivery, not by a pattern.
  const trimmed = email.trim();
  const at = trimmed.indexOf("@");
  if (at <= 0 || at === trimmed.length - 1) {
    throw new ValidationError(`"${trimmed}" is not a valid email address`, { email: trimmed });
  }
}
