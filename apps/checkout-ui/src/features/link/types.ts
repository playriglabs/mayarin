import type { LineItem, MerchantRef, MoneyDto } from "../../shared/types.ts";

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
  readonly accepted: readonly string[];
  /** Where the payer sends funds — the chain the minted intent will be watched on. */
  readonly chain: string;
  readonly lockMinutes: number;
}
