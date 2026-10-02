import type { LineItem, MerchantRef, MoneyDto, Protection, Rail } from "../../shared/types.ts";

/** The link page: what is being sold, in what asset, and one button. */
export interface LinkBootstrap {
  /** Buyer protection the merchant offers (#304); the buyer opts in by connecting a wallet. */
  readonly protection: Protection | null;
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
   * Why the rails list is empty when the link itself narrowed it to nothing
   * (#259). `null` when there is nothing specific to say.
   */
  readonly unpayableReason: string | null;
  readonly lockMinutes: number;
}
