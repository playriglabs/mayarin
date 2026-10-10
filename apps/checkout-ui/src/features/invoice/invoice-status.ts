import type { InvoiceStatus } from "./types.ts";

export const STATUS_LABEL: Readonly<Record<InvoiceStatus, string>> = {
  draft: "Draft",
  issued: "Unpaid",
  partially_paid: "Partially paid",
  paid: "Paid",
  overdue: "Overdue",
  void: "Void",
};

/** Only these two carry a warning colour. The rest are ordinary states. */
export const STATUS_TONE: Readonly<Record<InvoiceStatus, string>> = {
  draft: "text-muted",
  issued: "text-muted",
  partially_paid: "text-warning",
  paid: "text-brand",
  overdue: "text-warning",
  void: "text-muted",
};

const DATE = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "Asia/Jakarta" });

/** The day a payment landed, in the same long form as the issued/due line. */
export function paidOn(paidAt: string): string {
  return DATE.format(new Date(paidAt));
}

const SHORT_DATE = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "Asia/Jakarta",
});

/** "Oct 14, 2026" — for a label–value row, where the long form wraps. */
export function shortDate(iso: string): string {
  return SHORT_DATE.format(new Date(iso));
}

/** The issued/due line. An absent date is said in words, never as a dash. */
export function dateLine(issuedAt: string | null, dueAt: string | null): string {
  const parts = [
    issuedAt === null ? undefined : `Issued ${DATE.format(new Date(issuedAt))}`,
    dueAt === null ? undefined : `Due ${DATE.format(new Date(dueAt))}`,
  ].filter((part) => part !== undefined);
  return parts.length === 0 ? "Not yet issued" : parts.join(" · ");
}
