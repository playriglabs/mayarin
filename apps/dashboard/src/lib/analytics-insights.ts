import { PAYER_COUNTRY_METADATA_KEY } from "@mayarin/shared";
import { payInAmountUsd, settlementsByPaymentIntent } from "@/lib/analytics-movements";
import type { PaymentIntentDto } from "@/types/payment";
import type { SettlementDto } from "@/types/settlement";

export interface DateWindow {
  readonly from: number;
  readonly to: number;
}

export interface ReportingPeriods {
  readonly current: DateWindow;
  readonly previous: DateWindow;
}

export interface RankedInsight {
  readonly key: string;
  readonly count: number;
  readonly share: number;
}

export interface TimingInsight {
  readonly count: number;
  readonly medianSeconds: number;
  readonly p95Seconds: number;
}

export interface PeriodInsight {
  readonly paymentCount: number;
  readonly completedCount: number;
  readonly grossUsd: bigint;
  readonly averageUsd: bigint;
  readonly conversionRate: number;
  readonly completion: TimingInsight;
}

const DAY_MS = 86_400_000;

/** Two adjacent UTC windows, with today included in the current one. */
export function reportingPeriods(now: Date, days = 30): ReportingPeriods {
  const tomorrow = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const currentFrom = tomorrow - days * DAY_MS;
  return {
    current: { from: currentFrom, to: tomorrow },
    previous: { from: currentFrom - days * DAY_MS, to: currentFrom },
  };
}

export function inWindow(timestamp: string, window: DateWindow): boolean {
  const value = new Date(timestamp).getTime();
  return Number.isFinite(value) && value >= window.from && value < window.to;
}

export function paymentsIn(
  payments: readonly PaymentIntentDto[],
  window: DateWindow,
): readonly PaymentIntentDto[] {
  return payments.filter((payment) => inWindow(payment.createdAt, window));
}

export function settlementsIn(
  settlements: readonly SettlementDto[],
  window: DateWindow,
): readonly SettlementDto[] {
  return settlements.filter((settlement) =>
    inWindow(settlement.completedAt ?? settlement.updatedAt, window),
  );
}

function percentile(samples: readonly number[], percentileValue: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.ceil(percentileValue * sorted.length) - 1;
  return sorted[Math.max(0, index)] ?? 0;
}

export function completionTiming(payments: readonly PaymentIntentDto[]): TimingInsight {
  const samples = payments.flatMap((payment) => {
    if (payment.completedAt === null) return [];
    const seconds =
      (new Date(payment.completedAt).getTime() - new Date(payment.createdAt).getTime()) / 1_000;
    return Number.isFinite(seconds) && seconds >= 0 ? [seconds] : [];
  });
  return {
    count: samples.length,
    medianSeconds: percentile(samples, 0.5),
    p95Seconds: percentile(samples, 0.95),
  };
}

export function summarizePeriod(
  payments: readonly PaymentIntentDto[],
  settlements: readonly SettlementDto[],
): PeriodInsight {
  const byIntent = settlementsByPaymentIntent(settlements);
  const completed = payments.filter((payment) => payment.status === "COMPLETED");
  const grossAmounts = completed.flatMap((payment) => {
    const amount = payInAmountUsd(payment, byIntent.get(payment.id));
    return amount === null ? [] : [amount];
  });
  const grossUsd = grossAmounts.reduce((sum, amount) => sum + amount, 0n);

  return {
    paymentCount: payments.length,
    completedCount: completed.length,
    grossUsd,
    averageUsd: grossAmounts.length === 0 ? 0n : grossUsd / BigInt(grossAmounts.length),
    conversionRate: payments.length === 0 ? 0 : completed.length / payments.length,
    completion: completionTiming(completed),
  };
}

function ranked(values: readonly string[]): readonly RankedInsight[] {
  const counts = values.reduce<ReadonlyMap<string, number>>((held, value) => {
    const next = new Map(held);
    next.set(value, (next.get(value) ?? 0) + 1);
    return next;
  }, new Map<string, number>());
  const total = values.length;
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count, share: total === 0 ? 0 : count / total }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

function completed(payments: readonly PaymentIntentDto[]): readonly PaymentIntentDto[] {
  return payments.filter((payment) => payment.status === "COMPLETED");
}

export function payerAssetBreakdown(
  payments: readonly PaymentIntentDto[],
): readonly RankedInsight[] {
  return ranked(completed(payments).map((payment) => payment.payment?.asset ?? "Unknown"));
}

function payerCountry(payment: PaymentIntentDto): string {
  const value = payment.metadata[PAYER_COUNTRY_METADATA_KEY]?.trim().toUpperCase();
  return value !== undefined && /^[A-Z]{2}$/.test(value) ? value : "Unknown";
}

export function payerCountryBreakdown(
  payments: readonly PaymentIntentDto[],
): readonly RankedInsight[] {
  return ranked(completed(payments).map(payerCountry));
}
