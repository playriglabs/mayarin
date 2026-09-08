/**
 * Payment link creation and payability.
 *
 * A link is a template, not a payment: opening one mints a fresh Payment Intent
 * with its own price lock and its own expiry. That is what lets one printed QR
 * on a counter serve every sale of the day, and it is why the link carries no
 * status of its own beyond "still offered" — the intent owns the payment
 * lifecycle, the link only decides whether another intent may be minted.
 */

import type { MerchantSnapshot } from "@mayarin/payment-intent";
import {
  type AssetCode,
  generateId,
  InvalidStateTransitionError,
  isPositive,
  type Money,
  ValidationError,
} from "@mayarin/shared";
import type { PaymentLink, PaymentLinkKind, PaymentLinkLine } from "./types.ts";

export interface CreatePaymentLinkInput {
  readonly kind: PaymentLinkKind;
  readonly merchant: MerchantSnapshot;
  readonly amount?: Money;
  readonly currency?: AssetCode;
  readonly lines?: readonly PaymentLinkLine[];
  readonly title?: string;
  readonly merchantReference?: string;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly expiresAt?: Date;
  /** Whether the link is listed in the public x402 payable index (#273). */
  readonly listed?: boolean;
  readonly idempotencyKey?: string;
  readonly now: Date;
}

export function createPaymentLink(input: CreatePaymentLinkInput): PaymentLink {
  const shape = assertShape(input);
  const createdAt = new Date(input.now);

  if (input.expiresAt !== undefined && input.expiresAt.getTime() <= createdAt.getTime()) {
    throw new ValidationError("A payment link cannot expire in the past", {
      expiresAt: input.expiresAt.toISOString(),
    });
  }

  return {
    id: generateId("lnk", createdAt.getTime()),
    kind: input.kind,
    merchant: input.merchant,
    ...shape,
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.merchantReference === undefined
      ? {}
      : { merchantReference: input.merchantReference }),
    metadata: input.metadata ?? {},
    listed: input.listed ?? false,
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
    createdAt,
    updatedAt: createdAt,
    version: 1,
  };
}

export function disablePaymentLink(link: PaymentLink, now: Date): PaymentLink {
  if (link.disabledAt !== undefined) return link;
  return {
    ...link,
    disabledAt: new Date(now),
    updatedAt: new Date(now),
    version: link.version + 1,
  };
}

/** Lists a link in the public x402 payable index (#273). Payability is untouched. */
export function listPaymentLink(link: PaymentLink, now: Date): PaymentLink {
  if (link.listed) return link;
  return { ...link, listed: true, updatedAt: new Date(now), version: link.version + 1 };
}

/** Withdraws a link from the index. Payability is untouched. */
export function unlistPaymentLink(link: PaymentLink, now: Date): PaymentLink {
  if (!link.listed) return link;
  return { ...link, listed: false, updatedAt: new Date(now), version: link.version + 1 };
}

export function isLinkExpired(link: PaymentLink, now: Date): boolean {
  return link.expiresAt !== undefined && now.getTime() >= link.expiresAt.getTime();
}

export function isLinkPayable(link: PaymentLink, now: Date): boolean {
  return link.disabledAt === undefined && !isLinkExpired(link, now);
}

/**
 * Refuses to mint an intent from a link that is no longer offered.
 *
 * Expiry is enforced here and not only on the hosted page: a link's URL is the
 * whole integration surface, so anything that can be called directly has to
 * refuse directly.
 */
export function assertPayable(link: PaymentLink, now: Date): void {
  if (link.disabledAt !== undefined) {
    throw new InvalidStateTransitionError(`Payment link ${link.id} has been disabled`, {
      id: link.id,
      disabledAt: link.disabledAt.toISOString(),
    });
  }
  if (isLinkExpired(link, now)) {
    throw new InvalidStateTransitionError(`Payment link ${link.id} has expired`, {
      id: link.id,
      // Narrowed by `isLinkExpired`, which is false when `expiresAt` is absent.
      expiresAt: link.expiresAt?.toISOString(),
    });
  }
}

/** The currency a link denominates, whichever shape it takes. */
export function linkCurrency(link: PaymentLink): AssetCode | undefined {
  return link.kind === "fixed" ? link.amount?.asset : link.currency;
}

/**
 * Each kind carries exactly the fields it needs and none it does not.
 *
 * Checked once, at creation, so nothing downstream has to handle a `fixed` link
 * with no amount — a state the type permits and the constructor does not.
 */
function assertShape(
  input: CreatePaymentLinkInput,
): Pick<PaymentLink, "amount" | "currency" | "lines"> {
  switch (input.kind) {
    case "fixed": {
      if (input.amount === undefined) {
        throw new ValidationError("A fixed payment link requires an amount", {});
      }
      if (!isPositive(input.amount)) {
        throw new ValidationError("A fixed payment link amount must be greater than zero", {
          amount: input.amount.amount.toString(),
        });
      }
      return { amount: input.amount };
    }
    case "open": {
      if (input.currency === undefined) {
        throw new ValidationError("An open-amount payment link requires a currency", {});
      }
      return { currency: input.currency };
    }
    case "catalog": {
      const lines = input.lines ?? [];
      if (lines.length === 0) {
        throw new ValidationError("A catalog payment link requires at least one line", {});
      }
      if (input.currency === undefined) {
        throw new ValidationError("A catalog payment link requires a currency", {});
      }
      for (const line of lines) {
        if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
          throw new ValidationError(
            `Payment link line for ${line.productId} must have a positive integer quantity`,
            { productId: line.productId, quantity: line.quantity },
          );
        }
      }
      return { lines, currency: input.currency };
    }
  }
}
