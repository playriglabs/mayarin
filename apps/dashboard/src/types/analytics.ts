import type { PaymentIntentDto } from "@/types/payment";
import type { SettlementDto } from "@/types/settlement";

export interface AnalyticsResponse {
  readonly payments: readonly PaymentIntentDto[];
  readonly settlements: readonly SettlementDto[];
  /** USD per one whole token of each settlement asset, scaled by `USD_RATE_SCALE`. */
  readonly usdRates: Readonly<Record<string, string>>;
  /** What the merchant reads money in, and what one US dollar buys in it. */
  readonly display: { readonly currency: string; readonly perUsd: string };
}
