import { PAYER_COUNTRY_METADATA_KEY } from "@mayarin/shared";

/**
 * Adds Cloudflare's coarse country result to a payment without retaining an IP.
 * Cloudflare uses `XX` when the country is unknown and `T1` for Tor; neither is
 * an ISO country, so both remain "Unknown" in analytics.
 */
export function withPayerCountry(
  metadata: Readonly<Record<string, string>> | undefined,
  header: string | undefined,
): Readonly<Record<string, string>> | undefined {
  const country = header?.trim().toUpperCase();
  if (country === undefined || !/^[A-Z]{2}$/.test(country) || country === "XX") return metadata;
  return { ...metadata, [PAYER_COUNTRY_METADATA_KEY]: country };
}
