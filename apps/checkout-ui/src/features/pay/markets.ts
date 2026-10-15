/**
 * The markets a payer may pay in, with what a form needs to speak to them: the
 * calling code, an example number, an example city. Southeast Asia first.
 *
 * Only currencies Mayarin itself has a fiat asset for (`@mayarin/shared`): the
 * table is kept in step with that list, and the server narrows the provider's
 * offer to it again, so a currency here that the platform dropped is never shown.
 *
 * This is metadata about places, not a statement about what is available. Which
 * of these a deployment can actually take is the provider's answer, asked at
 * runtime (`/v1/fiat-onramp/currencies`) — so a market appears here the day the
 * provider enables its currency, with no change to this file.
 *
 * A currency shared by several countries (the CFA francs, EUR, USD) is left out:
 * a payer's country cannot be read from it, and the form needs one.
 */

export interface Market {
  readonly currency: string;
  readonly country: string;
  readonly phoneCode: string;
  readonly label: string;
  /** What a number looks like without the leading zero, as the field expects it. */
  readonly phoneExample: string;
  readonly cityExample: string;
}

export const MARKETS: readonly Market[] = [
  {
    currency: "PHP",
    country: "PH",
    phoneCode: "+63",
    label: "Philippines (PHP)",
    phoneExample: "917 123 4567",
    cityExample: "Manila",
  },
  {
    currency: "IDR",
    country: "ID",
    phoneCode: "+62",
    label: "Indonesia (IDR)",
    phoneExample: "812 3456 7890",
    cityExample: "Jakarta",
  },
  {
    currency: "MYR",
    country: "MY",
    phoneCode: "+60",
    label: "Malaysia (MYR)",
    phoneExample: "12 345 6789",
    cityExample: "Kuala Lumpur",
  },
  {
    currency: "SGD",
    country: "SG",
    phoneCode: "+65",
    label: "Singapore (SGD)",
    phoneExample: "8123 4567",
    cityExample: "Singapore",
  },
  {
    currency: "THB",
    country: "TH",
    phoneCode: "+66",
    label: "Thailand (THB)",
    phoneExample: "81 234 5678",
    cityExample: "Bangkok",
  },
  {
    currency: "VND",
    country: "VN",
    phoneCode: "+84",
    label: "Vietnam (VND)",
    phoneExample: "912 345 678",
    cityExample: "Ho Chi Minh City",
  },
  {
    currency: "KHR",
    country: "KH",
    phoneCode: "+855",
    label: "Cambodia (KHR)",
    phoneExample: "12 345 678",
    cityExample: "Phnom Penh",
  },
  {
    currency: "LAK",
    country: "LA",
    phoneCode: "+856",
    label: "Laos (LAK)",
    phoneExample: "20 2345 6789",
    cityExample: "Vientiane",
  },
  {
    currency: "MMK",
    country: "MM",
    phoneCode: "+95",
    label: "Myanmar (MMK)",
    phoneExample: "9 123 456 789",
    cityExample: "Yangon",
  },
  {
    currency: "BND",
    country: "BN",
    phoneCode: "+673",
    label: "Brunei (BND)",
    phoneExample: "712 3456",
    cityExample: "Bandar Seri Begawan",
  },
  {
    currency: "BRL",
    country: "BR",
    phoneCode: "+55",
    label: "Brazil (BRL)",
    phoneExample: "11 91234 5678",
    cityExample: "São Paulo",
  },
  {
    currency: "MXN",
    country: "MX",
    phoneCode: "+52",
    label: "Mexico (MXN)",
    phoneExample: "55 1234 5678",
    cityExample: "Mexico City",
  },
  {
    currency: "AED",
    country: "AE",
    phoneCode: "+971",
    label: "United Arab Emirates (AED)",
    phoneExample: "50 123 4567",
    cityExample: "Dubai",
  },
  {
    currency: "AUD",
    country: "AU",
    phoneCode: "+61",
    label: "Australia (AUD)",
    phoneExample: "412 345 678",
    cityExample: "Sydney",
  },
  {
    currency: "CAD",
    country: "CA",
    phoneCode: "+1",
    label: "Canada (CAD)",
    phoneExample: "416 555 0123",
    cityExample: "Toronto",
  },
];

/** A browser language that names a market without naming a region. */
const LANGUAGE_COUNTRY: Readonly<Record<string, string>> = {
  id: "ID",
  ms: "MY",
  fil: "PH",
  tl: "PH",
  th: "TH",
  vi: "VN",
  km: "KH",
  lo: "LA",
  my: "MM",
  pt: "BR",
};

/** The markets whose currency the provider can take, in the order above. */
/**
 * The flag of an ISO 3166 alpha-2 country, from its two letters: each maps to a
 * regional-indicator symbol, and a pair of them renders as the flag.
 */
export function flagEmoji(country: string): string {
  return [...country.toUpperCase()]
    .map((letter) => String.fromCodePoint(0x1f1e6 + letter.charCodeAt(0) - 65))
    .join("");
}

export function availableMarkets(currencies: readonly string[]): readonly Market[] {
  return MARKETS.filter((market) => currencies.includes(market.currency));
}

/**
 * The market a payer most likely means: their price currency if it is on offer,
 * else their browser's region, else its language, else the first on offer.
 */
export function pickMarket(
  markets: readonly Market[],
  hints: { readonly currency?: string; readonly locale?: string },
): Market | undefined {
  const byCurrency = markets.find((market) => market.currency === hints.currency);
  if (byCurrency !== undefined) return byCurrency;

  const [language = "", region = ""] = (hints.locale ?? "").split("-");
  const byRegion = markets.find((market) => market.country === region.toUpperCase());
  if (byRegion !== undefined) return byRegion;

  const country = LANGUAGE_COUNTRY[language.toLowerCase()];
  return markets.find((market) => market.country === country) ?? markets[0];
}
