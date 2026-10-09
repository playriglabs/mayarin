import { PAYER_COUNTRY_METADATA_KEY } from "@mayarin/shared";
import type { PaymentIntentDto } from "@/types/payment";

export interface DateWindow {
  readonly from: number;
  readonly to: number;
}

export interface RankedInsight {
  readonly key: string;
  readonly count: number;
  readonly share: number;
}

export function inWindow(timestamp: string, window: DateWindow): boolean {
  const value = new Date(timestamp).getTime();
  return Number.isFinite(value) && value >= window.from && value < window.to;
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

/** Rows a payer mix shows; everything from the fifth rank on folds into "Others". */
const MIX_LIMIT = 5;

function withOthers(rows: readonly RankedInsight[]): readonly RankedInsight[] {
  if (rows.length <= MIX_LIMIT) return rows;
  const rest = rows.slice(MIX_LIMIT - 1);
  return [
    ...rows.slice(0, MIX_LIMIT - 1),
    {
      key: "Others",
      count: rest.reduce((sum, row) => sum + row.count, 0),
      share: rest.reduce((sum, row) => sum + row.share, 0),
    },
  ];
}

function completed(payments: readonly PaymentIntentDto[]): readonly PaymentIntentDto[] {
  return payments.filter((payment) => payment.status === "COMPLETED");
}

export function payerAssetBreakdown(
  payments: readonly PaymentIntentDto[],
): readonly RankedInsight[] {
  return withOthers(
    ranked(completed(payments).map((payment) => payment.payment?.asset ?? "Unknown")),
  );
}

function payerCountry(payment: PaymentIntentDto): string {
  const value = payment.metadata[PAYER_COUNTRY_METADATA_KEY]?.trim().toUpperCase();
  return value !== undefined && /^[A-Z]{2}$/.test(value) ? value : "Unknown";
}

export function payerCountryBreakdown(
  payments: readonly PaymentIntentDto[],
): readonly RankedInsight[] {
  return withOthers(ranked(completed(payments).map(payerCountry)));
}

export function payerNetworkBreakdown(
  payments: readonly PaymentIntentDto[],
): readonly RankedInsight[] {
  return withOthers(
    ranked(completed(payments).map((payment) => payment.payment?.chain ?? "Unknown")),
  );
}
