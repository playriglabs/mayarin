/**
 * Countries, for the merchant profile (#150).
 *
 * The stored value is an ISO 3166-1 **alpha-2** code, because that is what the
 * payment API validates — `countryCode: z.string().length(2)`. A three-letter
 * code would save here and then fail every payment-link creation, so alpha-2 is
 * the only shape this module produces.
 *
 * Only the codes are checked in. Names come from `Intl.DisplayNames`, which
 * ships with the runtime, so there is no 250-row translation table in the
 * repository to fall out of date.
 */

/**
 * Where Mayarin can take a payment today: the United States and Southeast Asia.
 *
 * Every other country is listed but not selectable. Hiding them would say "this
 * country does not exist"; disabling them says "not yet", which is the true
 * statement and the one a merchant in a neighbouring market needs to read.
 */
export const SUPPORTED_COUNTRIES: readonly string[] = [
  "US",
  // ASEAN, plus Timor-Leste.
  "BN",
  "ID",
  "KH",
  "LA",
  "MM",
  "MY",
  "PH",
  "SG",
  "TH",
  "TL",
  "VN",
];

/** Every ISO 3166-1 alpha-2 code. The standard, uncurated. */
const ISO_ALPHA2: readonly string[] = [
  "AD",
  "AE",
  "AF",
  "AG",
  "AI",
  "AL",
  "AM",
  "AO",
  "AQ",
  "AR",
  "AS",
  "AT",
  "AU",
  "AW",
  "AX",
  "AZ",
  "BA",
  "BB",
  "BD",
  "BE",
  "BF",
  "BG",
  "BH",
  "BI",
  "BJ",
  "BL",
  "BM",
  "BN",
  "BO",
  "BQ",
  "BR",
  "BS",
  "BT",
  "BV",
  "BW",
  "BY",
  "BZ",
  "CA",
  "CC",
  "CD",
  "CF",
  "CG",
  "CH",
  "CI",
  "CK",
  "CL",
  "CM",
  "CN",
  "CO",
  "CR",
  "CU",
  "CV",
  "CW",
  "CX",
  "CY",
  "CZ",
  "DE",
  "DJ",
  "DK",
  "DM",
  "DO",
  "DZ",
  "EC",
  "EE",
  "EG",
  "EH",
  "ER",
  "ES",
  "ET",
  "FI",
  "FJ",
  "FK",
  "FM",
  "FO",
  "FR",
  "GA",
  "GB",
  "GD",
  "GE",
  "GF",
  "GG",
  "GH",
  "GI",
  "GL",
  "GM",
  "GN",
  "GP",
  "GQ",
  "GR",
  "GS",
  "GT",
  "GU",
  "GW",
  "GY",
  "HK",
  "HM",
  "HN",
  "HR",
  "HT",
  "HU",
  "ID",
  "IE",
  "IL",
  "IM",
  "IN",
  "IO",
  "IQ",
  "IR",
  "IS",
  "IT",
  "JE",
  "JM",
  "JO",
  "JP",
  "KE",
  "KG",
  "KH",
  "KI",
  "KM",
  "KN",
  "KP",
  "KR",
  "KW",
  "KY",
  "KZ",
  "LA",
  "LB",
  "LC",
  "LI",
  "LK",
  "LR",
  "LS",
  "LT",
  "LU",
  "LV",
  "LY",
  "MA",
  "MC",
  "MD",
  "ME",
  "MF",
  "MG",
  "MH",
  "MK",
  "ML",
  "MM",
  "MN",
  "MO",
  "MP",
  "MQ",
  "MR",
  "MS",
  "MT",
  "MU",
  "MV",
  "MW",
  "MX",
  "MY",
  "MZ",
  "NA",
  "NC",
  "NE",
  "NF",
  "NG",
  "NI",
  "NL",
  "NO",
  "NP",
  "NR",
  "NU",
  "NZ",
  "OM",
  "PA",
  "PE",
  "PF",
  "PG",
  "PH",
  "PK",
  "PL",
  "PM",
  "PN",
  "PR",
  "PS",
  "PT",
  "PW",
  "PY",
  "QA",
  "RE",
  "RO",
  "RS",
  "RU",
  "RW",
  "SA",
  "SB",
  "SC",
  "SD",
  "SE",
  "SG",
  "SH",
  "SI",
  "SJ",
  "SK",
  "SL",
  "SM",
  "SN",
  "SO",
  "SR",
  "SS",
  "ST",
  "SV",
  "SX",
  "SY",
  "SZ",
  "TC",
  "TD",
  "TF",
  "TG",
  "TH",
  "TJ",
  "TK",
  "TL",
  "TM",
  "TN",
  "TO",
  "TR",
  "TT",
  "TV",
  "TW",
  "TZ",
  "UA",
  "UG",
  "UM",
  "US",
  "UY",
  "UZ",
  "VA",
  "VC",
  "VE",
  "VG",
  "VI",
  "VN",
  "VU",
  "WF",
  "WS",
  "YE",
  "YT",
  "ZA",
  "ZM",
  "ZW",
];

export interface Country {
  /** ISO 3166-1 alpha-2. What is stored and sent. */
  readonly code: string;
  /** The country's own name, e.g. `Indonesia`. */
  readonly name: string;
  /** `ID - Indonesia`, which is what the list shows and searches over. */
  readonly label: string;
  readonly supported: boolean;
}

/**
 * `Intl.DisplayNames` returns the code itself for anything it cannot name, so a
 * runtime without the region data degrades to a usable `ID - ID` rather than
 * throwing. Built once: the constructor is the expensive part, not the lookup.
 */
const DISPLAY = new Intl.DisplayNames(["en"], { type: "region", fallback: "code" });

const supported = new Set(SUPPORTED_COUNTRIES);

/**
 * Every country, supported ones first and each group alphabetical.
 *
 * Sorted rather than left in code order so the eleven a merchant can actually
 * pick are the eleven they see before typing anything.
 */
export const COUNTRIES: readonly Country[] = ISO_ALPHA2.map((code) => {
  const name = DISPLAY.of(code) ?? code;
  return { code, name, label: `${code} - ${name}`, supported: supported.has(code) };
}).sort((a, b) => {
  if (a.supported !== b.supported) return a.supported ? -1 : 1;
  return a.name.localeCompare(b.name);
});

/** The stored code as something to read. Unknown codes show as themselves. */
export function countryLabel(code: string): string {
  const match = COUNTRIES.find((country) => country.code === code.toUpperCase());
  return match?.label ?? code;
}
