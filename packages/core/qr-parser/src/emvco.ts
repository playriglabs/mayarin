/**
 * EMVCo Merchant-Presented Mode (MPM) decoding.
 *
 * The payload is a flat TLV string: a 2-digit tag, a 2-digit length, then that
 * many characters of value. Some values are themselves TLV templates.
 *
 * This module knows the *encoding* only. Meaning of individual tags belongs to
 * a scheme profile (see `qris.ts`), so a new QR standard is a new profile, not
 * a fork of the decoder.
 */

import { QrParseError } from "./errors.ts";

export interface EmvField {
  readonly tag: string;
  readonly value: string;
}

/** EMVCo root tags Mayarr reads. Scheme-specific meaning lives in profiles. */
export const EMV_TAG = {
  payloadFormatIndicator: "00",
  pointOfInitiationMethod: "01",
  merchantCategoryCode: "52",
  transactionCurrency: "53",
  transactionAmount: "54",
  tipIndicator: "55",
  convenienceFeeFixed: "56",
  convenienceFeePercentage: "57",
  countryCode: "58",
  merchantName: "59",
  merchantCity: "60",
  postalCode: "61",
  additionalData: "62",
  crc: "63",
} as const;

/** Tags 02–51 carry merchant account information templates. */
export const MERCHANT_ACCOUNT_TAG_RANGE = { min: 2, max: 51 } as const;

export const CRC_TAG = EMV_TAG.crc;
const CRC_PREFIX = `${CRC_TAG}04`;

/** Decodes one level of TLV. Nested templates are decoded by calling again. */
export function parseEmvTlv(payload: string): EmvField[] {
  const fields: EmvField[] = [];
  let cursor = 0;

  while (cursor < payload.length) {
    if (payload.length - cursor < 4) {
      throw new QrParseError("Truncated TLV: expected a 2-digit tag and 2-digit length", {
        cursor,
        remainder: payload.slice(cursor),
      });
    }

    const tag = payload.slice(cursor, cursor + 2);
    const rawLength = payload.slice(cursor + 2, cursor + 4);

    if (!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(rawLength)) {
      throw new QrParseError("Malformed TLV: tag and length must be two digits each", {
        cursor,
        tag,
        length: rawLength,
      });
    }

    const length = Number(rawLength);
    const start = cursor + 4;
    const end = start + length;

    if (end > payload.length) {
      throw new QrParseError(`Field "${tag}" declares ${length} characters beyond payload end`, {
        tag,
        length,
        available: payload.length - start,
      });
    }

    fields.push({ tag, value: payload.slice(start, end) });
    cursor = end;
  }

  return fields;
}

/**
 * Indexes fields by tag. EMVCo forbids duplicate tags at the same level; a
 * duplicate means a corrupt or hand-crafted payload, so it is rejected rather
 * than silently resolved last-wins.
 */
export function indexFields(fields: readonly EmvField[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const field of fields) {
    if (map.has(field.tag)) {
      throw new QrParseError(`Duplicate EMVCo tag "${field.tag}"`, { tag: field.tag });
    }
    map.set(field.tag, field.value);
  }
  return map;
}

export function isMerchantAccountTag(tag: string): boolean {
  const numeric = Number(tag);
  return (
    Number.isInteger(numeric) &&
    numeric >= MERCHANT_ACCOUNT_TAG_RANGE.min &&
    numeric <= MERCHANT_ACCOUNT_TAG_RANGE.max
  );
}

/**
 * CRC-16/CCITT-FALSE — polynomial 0x1021, initial value 0xFFFF, no reflection,
 * no final XOR. Mandated by EMVCo for tag 63.
 */
export function crc16(input: string): string {
  let crc = 0xffff;

  for (let i = 0; i < input.length; i += 1) {
    crc ^= input.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }

  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * Verifies the trailing checksum.
 *
 * The CRC covers the whole payload *including* the "6304" tag and length, so it
 * is recomputed over everything up to the four checksum characters.
 */
export function verifyCrc(payload: string): void {
  const crcStart = payload.length - 8;

  if (crcStart < 0 || payload.slice(crcStart, crcStart + 4) !== CRC_PREFIX) {
    throw new QrParseError("Payload does not end with a CRC field (tag 63, length 04)", {
      tail: payload.slice(-8),
    });
  }

  const provided = payload.slice(crcStart + 4);
  const expected = crc16(payload.slice(0, crcStart + 4));

  if (provided.toUpperCase() !== expected) {
    throw new QrParseError("CRC mismatch — the QR payload is corrupt or was altered", {
      provided,
      expected,
    });
  }
}

/** Appends a valid CRC to an otherwise complete payload. Used by tests and tooling. */
export function withCrc(payloadWithoutCrc: string): string {
  const base = `${payloadWithoutCrc}${CRC_PREFIX}`;
  return `${base}${crc16(base)}`;
}
