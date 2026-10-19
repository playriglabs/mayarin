/**
 * Notification DTOs — what the bell shows.
 *
 * The wording lives here, one entry per type in a total table, so adding a type
 * is a compiler error until it has a line. The dashboard renders `title` and
 * `body` as they are and links to `href`.
 */

import { shortHash } from "@mayarin/chain";
import type { MerchantNotification, MerchantNotificationType } from "@mayarin/db";
import { numericReference } from "@mayarin/shared";
import { type MoneyDto, toMoneyDto } from "./money.ts";

export const NOTIFICATION_CATEGORIES = ["payment", "dispute", "security", "operations"] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export type NotificationTone = "info" | "success" | "warning" | "error";

export interface NotificationDto {
  readonly id: string;
  readonly type: MerchantNotificationType;
  readonly category: NotificationCategory;
  readonly tone: NotificationTone;
  readonly title: string;
  readonly body: string | null;
  readonly href: string | null;
  readonly amount: MoneyDto | null;
  readonly occurredAt: string;
  readonly unread: boolean;
}

interface Line {
  readonly tone: NotificationTone;
  readonly title: string;
  readonly body?: string;
  readonly href?: string;
}

type Describe = (n: MerchantNotification, ctx: Context) => Line;

interface Context {
  /** `#<reference>` of the payment, or empty. */
  readonly payment: string;
  /** The amount, rendered for a person, or empty. */
  readonly amount: string;
  readonly paymentHref: string | undefined;
  readonly disputeHref: string | undefined;
}

const SETTING_LABELS: Readonly<Record<string, string>> = {
  settlementAsset: "settlement asset",
  settlementAssetByChain: "settlement asset per network",
  acceptedAssets: "accepted assets",
  acceptedAssetsByChain: "accepted assets per network",
  buyerProtection: "buyer protection",
  settlementAddress: "payout address",
  city: "city",
  countryCode: "country",
  displayCurrency: "display currency",
};

/** Which filter a notification falls under. */
export const NOTIFICATION_CATEGORY: Readonly<
  Record<MerchantNotificationType, NotificationCategory>
> = {
  "payment.received": "payment",
  "payment.held": "payment",
  "payment.paid": "payment",
  "payment.failed": "payment",
  "dispute.opened": "dispute",
  "dispute.message": "dispute",
  "dispute.deadline": "dispute",
  "dispute.released": "dispute",
  "dispute.refunded": "dispute",
  "dispute.split": "dispute",
  "refund.succeeded": "payment",
  "refund.failed": "payment",
  "withdrawal.sent": "payment",
  "payout.sent": "payment",
  "settings.changed": "operations",
  "security.settlement_address": "security",
  "security.sign_in": "security",
  "security.api_key_created": "security",
  "security.api_key_revoked": "security",
  "security.member_added": "security",
  "webhook.failed": "operations",
  "invoice.paid": "operations",
  "invoice.overdue": "operations",
  "subscription.cancelled": "operations",
};

const LINES: Readonly<Record<MerchantNotificationType, Describe>> = {
  "payment.received": (_, c) => ({
    tone: "info",
    title: `Payment ${c.payment} made`,
    body: `The buyer paid ${c.amount}. It is clearing now.`,
    ...href(c.paymentHref),
  }),
  "payment.held": (n, c) => ({
    tone: "info",
    title: `Payment ${c.payment} held in escrow`,
    body: `${c.amount} is released to you ${when(n.detail)} unless the buyer disputes it.`,
    ...href(c.paymentHref),
  }),
  "payment.paid": (_, c) => ({
    tone: "success",
    title: `🎉 You got paid ${c.amount}`,
    body: `Payment ${c.payment} completed with no dispute.`,
    ...href(c.paymentHref),
  }),
  "payment.failed": (n, c) => ({
    tone: "error",
    title: `Payment ${c.payment} failed`,
    body: n.detail ?? `The ${c.amount} payment did not complete.`,
    ...href(c.paymentHref),
  }),
  "dispute.opened": (n, c) => ({
    tone: "warning",
    title: `Payment ${c.payment} got disputed`,
    body: `Answer with your evidence. Undecided, the buyer is refunded ${when(n.detail)}.`,
    ...href(c.disputeHref),
  }),
  "dispute.message": (n, c) => ({
    tone: "info",
    title: `New message on the dispute over ${c.payment}`,
    body: n.detail === "arbiter" ? "From Mayarin Resolution." : "From the buyer.",
    ...href(c.disputeHref),
  }),
  "dispute.deadline": (n, c) => ({
    tone: "warning",
    title: `Dispute over ${c.payment} closes soon`,
    body: `The buyer is refunded ${when(n.detail)} unless it is decided first.`,
    ...href(c.disputeHref),
  }),
  "dispute.released": (_, c) => ({
    tone: "success",
    title: `Dispute over ${c.payment} decided for you`,
    body: `${c.amount} is released to you.`,
    ...href(c.disputeHref),
  }),
  "dispute.refunded": (_, c) => ({
    tone: "error",
    title: `Payment ${c.payment} refunded`,
    body: `The buyer won the dispute and got ${c.amount} back.`,
    ...href(c.disputeHref),
  }),
  "dispute.split": (_, c) => ({
    tone: "info",
    title: `Dispute over ${c.payment} split`,
    body: `The arbiter divided ${c.amount} between you and the buyer.`,
    ...href(c.disputeHref),
  }),
  "refund.succeeded": (_, c) => ({
    tone: "info",
    title: `Refund of ${c.amount} sent`,
    body: `For payment ${c.payment}.`,
    ...href(c.paymentHref),
  }),
  "refund.failed": (n, c) => ({
    tone: "error",
    title: `Refund of ${c.amount} failed`,
    body: n.detail ?? `For payment ${c.payment}.`,
    ...href(c.paymentHref),
  }),
  "withdrawal.sent": (n, c) => ({
    tone: "info",
    title: `Withdrew ${c.amount}`,
    body: `To ${n.detail === undefined ? "an external address" : shortHash(n.detail)}.`,
    href: "/wallets",
  }),
  "payout.sent": (n) => ({
    tone: "info",
    title: "Batch payout sent",
    body: `${n.detail ?? "Several"} recipients paid.`,
    href: "/payouts",
  }),
  "settings.changed": (n) => ({
    tone: "info",
    title: "Settings changed",
    body: `${n.actor ?? "Someone"} changed the ${SETTING_LABELS[n.detail ?? ""] ?? n.detail ?? "settings"}.`,
    href: "/settings",
  }),
  "security.settlement_address": (n) => ({
    tone: "warning",
    title: "Payout address changed",
    body: `${n.actor ?? "Someone"} changed where you are paid. If this was not your team, act now.`,
    href: "/settings",
  }),
  "security.sign_in": (n) => ({
    tone: "info",
    title: "New sign-in",
    body: `${n.actor ?? "An account"} signed in to the dashboard.`,
  }),
  "security.api_key_created": (n) => ({
    tone: "info",
    title: "API key created",
    body: `“${n.detail ?? "Unnamed"}” can now reach your account.`,
    href: "/api-keys",
  }),
  "security.api_key_revoked": (n) => ({
    tone: "info",
    title: "API key revoked",
    body: `“${n.detail ?? "Unnamed"}” no longer works.`,
    href: "/api-keys",
  }),
  "security.member_added": (n) => ({
    tone: "info",
    title: "Team member added",
    body: `${n.actor ?? "A new account"} can now sign in to this merchant.`,
    href: "/admin",
  }),
  "webhook.failed": (n) => ({
    tone: "error",
    title: "Webhook delivery gave up",
    body: `${n.detail ?? "Your endpoint"} did not accept an event after every retry.`,
    href: "/webhooks",
  }),
  "invoice.paid": (n, c) => ({
    tone: "success",
    title: `Invoice ${n.detail ?? ""} paid`,
    body: `${c.amount} received in full.`,
    href: "/invoices",
  }),
  "invoice.overdue": (n, c) => ({
    tone: "warning",
    title: `Invoice ${n.detail ?? ""} overdue`,
    body: `${c.amount} is past its due date and not paid in full.`,
    href: "/invoices",
  }),
  "subscription.cancelled": (n) => ({
    tone: "info",
    title: "Subscription cancelled",
    body: `${n.detail ?? "A subscriber"} will not be billed again.`,
    href: "/subscriptions",
  }),
};

export function toNotificationDto(
  notification: MerchantNotification & { readonly unread: boolean },
): NotificationDto {
  const { paymentIntentId, disputeId, amount } = notification;
  const line = LINES[notification.type](notification, {
    payment: paymentIntentId === undefined ? "" : `#${numericReference(paymentIntentId)}`,
    amount: amount === undefined ? "" : toMoneyDto(amount).display,
    paymentHref: paymentIntentId === undefined ? undefined : `/payments/${paymentIntentId}`,
    disputeHref: disputeId === undefined ? undefined : `/disputes/${disputeId}`,
  });
  return {
    id: notification.id,
    type: notification.type,
    category: NOTIFICATION_CATEGORY[notification.type],
    tone: line.tone,
    title: line.title,
    body: line.body ?? null,
    href: line.href ?? null,
    amount: amount === undefined ? null : toMoneyDto(amount),
    occurredAt: notification.occurredAt.toISOString(),
    unread: notification.unread,
  };
}

function href(value: string | undefined): { href?: string } {
  return value === undefined ? {} : { href: value };
}

/** `on 3 Oct 2026, 14:00 UTC` from an ISO instant; the feed has no reader timezone. */
function when(iso: string | undefined): string {
  if (iso === undefined) return "later";
  const formatted = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(iso));
  return `on ${formatted} UTC`;
}
