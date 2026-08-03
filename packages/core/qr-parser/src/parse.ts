/**
 * QR payload parser.
 *
 * Decodes an EMVCo MPM payload and normalizes it into `ParsedQr`. QRIS is a
 * profile on top of EMVCo, so it is detected rather than parsed separately.
 */

import { assetFromIso4217Numeric, fromDecimalString } from "@mayarin/shared";
import {
  EMV_TAG,
  type EmvField,
  indexFields,
  isMerchantAccountTag,
  parseEmvTlv,
  verifyCrc,
} from "./emvco.ts";
import { QrParseError } from "./errors.ts";
import type { AdditionalData, MerchantAccount, ParsedQr, QrScheme } from "./types.ts";

const SUPPORTED_PAYLOAD_FORMAT = "01";
const POINT_OF_INITIATION_DYNAMIC = "12";
const QRIS_GUID_PREFIX = "ID.CO.QRIS";

/** Nested tags inside a merchant account information template. */
const ACCOUNT_TAG = {
  globalUniqueIdentifier: "00",
  merchantPan: "01",
  merchantId: "02",
  merchantCriteria: "03",
} as const;

/** Nested tags inside the additional data field template (EMVCo tag 62). */
const ADDITIONAL_DATA_TAGS = {
  "01": "billNumber",
  "02": "mobileNumber",
  "03": "storeLabel",
  "04": "loyaltyNumber",
  "05": "referenceLabel",
  "06": "customerLabel",
  "07": "terminalLabel",
  "08": "purposeOfTransaction",
} as const satisfies Record<string, keyof AdditionalData>;

export function parseQr(payload: string): ParsedQr {
  // Only surrounding whitespace is noise. Interior spaces are payload — merchant
  // names carry them, and they are covered by the CRC.
  const raw = payload.trim();

  if (raw.length === 0) {
    throw new QrParseError("QR payload is empty");
  }

  verifyCrc(raw);

  const fields = parseEmvTlv(raw);
  const root = indexFields(fields);

  const payloadFormat = root.get(EMV_TAG.payloadFormatIndicator);
  if (payloadFormat !== SUPPORTED_PAYLOAD_FORMAT) {
    throw new QrParseError(
      `Unsupported EMVCo payload format indicator: "${payloadFormat ?? "missing"}"`,
      { payloadFormat },
    );
  }

  const currency = readCurrency(root.get(EMV_TAG.transactionCurrency));
  const merchantAccounts = readMerchantAccounts(fields);
  const merchantId = resolveMerchantId(merchantAccounts);
  const amountValue = root.get(EMV_TAG.transactionAmount);

  return {
    scheme: detectScheme(merchantAccounts),
    isStatic: root.get(EMV_TAG.pointOfInitiationMethod) !== POINT_OF_INITIATION_DYNAMIC,
    merchantName: required(root, EMV_TAG.merchantName, "merchant name"),
    merchantId,
    merchantCity: required(root, EMV_TAG.merchantCity, "merchant city"),
    countryCode: required(root, EMV_TAG.countryCode, "country code").toUpperCase(),
    currency,
    ...(amountValue === undefined ? {} : { amount: readAmount(amountValue, currency) }),
    ...optional("merchantCategoryCode", root.get(EMV_TAG.merchantCategoryCode)),
    ...optional("postalCode", root.get(EMV_TAG.postalCode)),
    merchantAccounts,
    additionalData: readAdditionalData(root.get(EMV_TAG.additionalData)),
    raw,
  };
}

function required(root: Map<string, string>, tag: string, label: string): string {
  const value = root.get(tag);
  if (value === undefined || value.length === 0) {
    throw new QrParseError(`QR payload is missing the ${label} (tag ${tag})`, { tag });
  }
  return value;
}

function optional<K extends string>(key: K, value: string | undefined): Record<K, string> | object {
  return value === undefined || value.length === 0 ? {} : ({ [key]: value } as Record<K, string>);
}

function readCurrency(numeric: string | undefined) {
  if (numeric === undefined) {
    throw new QrParseError(
      `QR payload is missing the transaction currency (tag ${EMV_TAG.transactionCurrency})`,
    );
  }

  const asset = assetFromIso4217Numeric(numeric);
  if (asset === undefined) {
    throw new QrParseError(`Unsupported transaction currency (ISO 4217 numeric ${numeric})`, {
      numeric,
    });
  }
  return asset;
}

function readAmount(value: string, currency: ReturnType<typeof readCurrency>) {
  try {
    return fromDecimalString(value, currency);
  } catch (error) {
    throw new QrParseError(
      `Invalid transaction amount "${value}" for ${currency}`,
      {
        value,
        currency,
      },
      { cause: error },
    );
  }
}

/**
 * Reads tags 02–51.
 *
 * Card-scheme templates (Visa, Mastercard) carry a bare PAN rather than nested
 * TLV, so a template that does not decode is kept as a PAN instead of failing
 * the whole payload.
 */
function readMerchantAccounts(fields: readonly EmvField[]): MerchantAccount[] {
  const accounts: MerchantAccount[] = [];

  for (const field of fields) {
    if (!isMerchantAccountTag(field.tag)) continue;

    let nested: EmvField[];
    try {
      nested = parseEmvTlv(field.value);
    } catch {
      accounts.push({ tag: field.tag, merchantPan: field.value, fields: [] });
      continue;
    }

    const indexed = new Map(nested.map((entry) => [entry.tag, entry.value]));
    const guid = indexed.get(ACCOUNT_TAG.globalUniqueIdentifier);

    // A template without a GUID is not a nested account — treat it as a PAN.
    if (guid === undefined) {
      accounts.push({ tag: field.tag, merchantPan: field.value, fields: [] });
      continue;
    }

    accounts.push({
      tag: field.tag,
      globalUniqueIdentifier: guid,
      ...optional("merchantPan", indexed.get(ACCOUNT_TAG.merchantPan)),
      ...optional("merchantId", indexed.get(ACCOUNT_TAG.merchantId)),
      ...optional("merchantCriteria", indexed.get(ACCOUNT_TAG.merchantCriteria)),
      fields: nested,
    });
  }

  return accounts;
}

/**
 * Picks the identifier a settlement adapter can route on.
 *
 * A scheme merchant id (QRIS NMID) is preferred over a PAN because it is stable
 * across acquirers.
 */
function resolveMerchantId(accounts: readonly MerchantAccount[]): string {
  const qrisAccount = accounts.find(
    (account) =>
      account.globalUniqueIdentifier?.toUpperCase().startsWith(QRIS_GUID_PREFIX) === true,
  );

  const candidate =
    qrisAccount?.merchantId ??
    accounts.find((account) => account.merchantId !== undefined)?.merchantId ??
    qrisAccount?.merchantPan ??
    accounts.find((account) => account.merchantPan !== undefined)?.merchantPan;

  if (candidate === undefined) {
    throw new QrParseError("QR payload carries no merchant account information (tags 02–51)");
  }
  return candidate;
}

function detectScheme(accounts: readonly MerchantAccount[]): QrScheme {
  return accounts.some(
    (account) =>
      account.globalUniqueIdentifier?.toUpperCase().startsWith(QRIS_GUID_PREFIX) === true,
  )
    ? "QRIS"
    : "EMVCO";
}

function readAdditionalData(value: string | undefined): AdditionalData {
  if (value === undefined) return {};

  let nested: EmvField[];
  try {
    nested = parseEmvTlv(value);
  } catch {
    // Additional data is advisory; a malformed template must not reject a payment.
    return {};
  }

  const data: Record<string, string> = {};
  for (const field of nested) {
    const key = ADDITIONAL_DATA_TAGS[field.tag as keyof typeof ADDITIONAL_DATA_TAGS];
    if (key !== undefined && field.value.length > 0) data[key] = field.value;
  }
  return data as AdditionalData;
}
