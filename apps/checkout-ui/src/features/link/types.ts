import type { LineItem, MerchantRef, MoneyDto, Rail } from "../../shared/types.ts";

/** The link page: what is being sold, in what asset, and one button. */
export interface LinkBootstrap {
  readonly page: "link";
  readonly linkId: string;
  readonly kind: "fixed" | "open" | "catalog";
  readonly title: string;
  readonly merchant: MerchantRef;
  readonly payable: boolean;
  /** The currency an `open` link asks the buyer to type an amount in. */
  readonly currency: string | null;
  /** The priced total. `null` for an `open` link, which has none until the buyer types. */
  readonly total: MoneyDto | null;
  /** Catalog lines, so a buyer can check what they are paying for. */
  readonly lines: readonly LineItem[] | null;
  /**
   * Every rail this merchant can be paid on (#244).
   *
   * The payer's choice is what mints the intent, so the deposit address and the
   * price lock belong to the rail they chose. Empty means the merchant has no
   * payable rail at all, which the page states rather than hiding behind a
   * button that would fail.
   */
  readonly rails: readonly Rail[];
  /**
   * What the merchant is paid in. The estimate quotes against it: it is what
   * decides whether the payer's asset has a swap leg, and a preview that skips
   * it shows the pure FX rate for a payment that will take the swap.
   */
  readonly settlementAsset: string;
  readonly lockMinutes: number;
}
