import type { PaymentIntentDto } from "@/types/payment";
import type { SettlementDto } from "@/types/settlement";

export interface AnalyticsResponse {
  readonly payments: readonly PaymentIntentDto[];
  readonly settlements: readonly SettlementDto[];
}
