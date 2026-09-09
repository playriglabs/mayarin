import type { AssetCode } from "@mayarin/shared";

export type CurrencyRegion =
  | "Southeast Asia"
  | "East Asia"
  | "Europe"
  | "North America"
  | "APAC"
  | "Middle East"
  | "Latin America";

export type CurrencyMarket = {
  readonly id: string;
  readonly market: string;
  readonly code: AssetCode;
  readonly region: CurrencyRegion;
  readonly location: [number, number];
};

/**
 * Reference market for every fiat currency in Mayarin's pricing registry.
 *
 * These points describe currency coverage, not merchant onboarding or a
 * regulated payment corridor. Keep the wording in the UI equally precise.
 */
export const CURRENCY_MARKETS: readonly CurrencyMarket[] = [
  {
    id: "indonesia",
    market: "Indonesia",
    code: "IDR",
    region: "Southeast Asia",
    location: [-6.2088, 106.8456],
  },
  {
    id: "singapore",
    market: "Singapore",
    code: "SGD",
    region: "Southeast Asia",
    location: [1.3521, 103.8198],
  },
  {
    id: "malaysia",
    market: "Malaysia",
    code: "MYR",
    region: "Southeast Asia",
    location: [3.139, 101.6869],
  },
  {
    id: "thailand",
    market: "Thailand",
    code: "THB",
    region: "Southeast Asia",
    location: [13.7563, 100.5018],
  },
  {
    id: "philippines",
    market: "Philippines",
    code: "PHP",
    region: "Southeast Asia",
    location: [14.5995, 120.9842],
  },
  {
    id: "vietnam",
    market: "Vietnam",
    code: "VND",
    region: "Southeast Asia",
    location: [21.0278, 105.8342],
  },
  {
    id: "brunei",
    market: "Brunei",
    code: "BND",
    region: "Southeast Asia",
    location: [4.9031, 114.9398],
  },
  {
    id: "myanmar",
    market: "Myanmar",
    code: "MMK",
    region: "Southeast Asia",
    location: [19.7633, 96.0785],
  },
  {
    id: "cambodia",
    market: "Cambodia",
    code: "KHR",
    region: "Southeast Asia",
    location: [11.5564, 104.9282],
  },
  {
    id: "laos",
    market: "Laos",
    code: "LAK",
    region: "Southeast Asia",
    location: [17.9757, 102.6331],
  },
  {
    id: "united-states",
    market: "United States",
    code: "USD",
    region: "North America",
    location: [38.9072, -77.0369],
  },
  {
    id: "japan",
    market: "Japan",
    code: "JPY",
    region: "East Asia",
    location: [35.6762, 139.6503],
  },
  {
    id: "china",
    market: "China",
    code: "CNY",
    region: "East Asia",
    location: [39.9042, 116.4074],
  },
  {
    id: "hong-kong",
    market: "Hong Kong",
    code: "HKD",
    region: "East Asia",
    location: [22.3193, 114.1694],
  },
  {
    id: "euro-area",
    market: "Euro area",
    code: "EUR",
    region: "Europe",
    location: [50.1109, 8.6821],
  },
  {
    id: "united-kingdom",
    market: "United Kingdom",
    code: "GBP",
    region: "Europe",
    location: [51.5074, -0.1278],
  },
  {
    id: "australia",
    market: "Australia",
    code: "AUD",
    region: "APAC",
    location: [-35.2809, 149.13],
  },
  {
    id: "canada",
    market: "Canada",
    code: "CAD",
    region: "North America",
    location: [45.4215, -75.6972],
  },
  {
    id: "united-arab-emirates",
    market: "United Arab Emirates",
    code: "AED",
    region: "Middle East",
    location: [25.2048, 55.2708],
  },
  {
    id: "saudi-arabia",
    market: "Saudi Arabia",
    code: "SAR",
    region: "Middle East",
    location: [24.7136, 46.6753],
  },
  {
    id: "brazil",
    market: "Brazil",
    code: "BRL",
    region: "Latin America",
    location: [-15.7939, -47.8828],
  },
  {
    id: "mexico",
    market: "Mexico",
    code: "MXN",
    region: "Latin America",
    location: [19.4326, -99.1332],
  },
];
