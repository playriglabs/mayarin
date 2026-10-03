import type { Container } from "./container.ts";

/**
 * The logo the merchant uploaded in dashboard Settings, or `null` for none.
 * The buyer pages show it in place of the Mayarin mark.
 */
export async function merchantLogoUrl(
  container: Pick<Container, "merchants">,
  merchantId: string,
): Promise<string | null> {
  return (await container.merchants.findById(merchantId))?.logoUrl ?? null;
}
