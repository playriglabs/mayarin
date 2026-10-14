/**
 * The payer fields a method asks for, taken from what the payer gave.
 *
 * Methods differ — QR Ph wants a name, GCash a phone and email too — so the
 * order carries exactly what the method lists and nothing more. A field the
 * method wants that we do not collect comes back in `missing`, so the payer is
 * told that this method cannot be used rather than sent into a failed order.
 */

export interface Contact {
  readonly firstName?: string | undefined;
  readonly lastName?: string | undefined;
  readonly email?: string | undefined;
  readonly phone?: string | undefined;
  readonly phoneCode?: string | undefined;
}

const COLLECTED: readonly (keyof Contact)[] = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "phoneCode",
];

export function detailsFor(
  fields: readonly string[],
  contact: Contact,
): { readonly details: Record<string, string>; readonly missing: readonly string[] } {
  const details: Record<string, string> = {};
  const missing: string[] = [];

  for (const field of fields) {
    const known = COLLECTED.find((name) => name === field);
    const value = known === undefined ? undefined : contact[known];
    if (value === undefined || value === "") missing.push(field);
    else details[field] = value;
  }

  return { details, missing };
}
