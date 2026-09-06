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
  draft: "muted",
  issued: "muted",
  partially_paid: "warn",
  paid: "ok",
  overdue: "warn",
  void: "muted",
};

const DATE = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "Asia/Jakarta" });

/** The day a payment landed, in the same long form as the issued/due line. */
export function paidOn(paidAt: string): string {
  return DATE.format(new Date(paidAt));
}

/** The issued/due line. An absent date is said in words, never as a dash. */
export function dateLine(issuedAt: string | null, dueAt: string | null): string {
  const parts = [
    issuedAt === null ? undefined : `Issued ${DATE.format(new Date(issuedAt))}`,
    dueAt === null ? undefined : `Due ${DATE.format(new Date(dueAt))}`,
  ].filter((part) => part !== undefined);
  return parts.length === 0 ? "Not yet issued" : parts.join(" · ");
}
