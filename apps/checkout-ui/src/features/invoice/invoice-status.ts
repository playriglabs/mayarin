import type { MessageKey } from "../../i18n/en.ts";
import { type Translate, translateEnglish } from "../../i18n/index.tsx";
import type { InvoiceStatus } from "./types.ts";

const STATUS_KEY = {
  draft: "invoiceDraft",
  issued: "invoiceUnpaid",
  partially_paid: "invoicePartiallyPaid",
  paid: "invoicePaid",
  overdue: "invoiceOverdue",
  void: "invoiceVoid",
} as const satisfies Readonly<Record<InvoiceStatus, MessageKey>>;

export function statusLabel(status: InvoiceStatus, t: Translate = translateEnglish): string {
  return t(STATUS_KEY[status]);
}

export const STATUS_TONE: Readonly<Record<InvoiceStatus, string>> = {
  draft: "text-muted",
  issued: "text-muted",
  partially_paid: "text-warning",
  paid: "text-brand",
  overdue: "text-warning",
  void: "text-muted",
};

/** Dates are shown in the payer's language, always in Jakarta time as before. */
function formatDate(iso: string, locale: string, dateStyle: "long" | "medium"): string {
  return new Intl.DateTimeFormat(locale, { dateStyle, timeZone: "Asia/Jakarta" }).format(
    new Date(iso),
  );
}

export function paidOn(paidAt: string, locale = "en-US"): string {
  return formatDate(paidAt, locale, "long");
}

export function shortDate(iso: string, locale = "en-US"): string {
  return formatDate(iso, locale, "medium");
}

export function dateLine(
  issuedAt: string | null,
  dueAt: string | null,
  t: Translate = translateEnglish,
  locale = "en-US",
): string {
  const parts = [
    issuedAt === null ? undefined : t("issuedOn", { date: paidOn(issuedAt, locale) }),
    dueAt === null ? undefined : t("dueOn", { date: paidOn(dueAt, locale) }),
  ].filter((part) => part !== undefined);
  return parts.length === 0 ? t("notYetIssued") : parts.join(" · ");
}
