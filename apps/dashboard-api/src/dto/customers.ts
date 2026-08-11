/**
 * Customer request schemas and response DTOs.
 *
 * No route takes a merchant id: the merchant is the one on the session, and a
 * field that cannot be sent cannot be forged.
 */

import type { Customer } from "@mayarin/catalog";
import { z } from "zod";
import type { MoneyDto } from "./money.ts";
import type { OrderDto } from "./orders.ts";

export const createCustomerBodySchema = z
  .object({
    name: z.string().min(1).max(255),
    email: z.string().max(320).optional(),
    notes: z.string().max(2_000).optional(),
  })
  .strict();

export const updateCustomerBodySchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    /** `null` clears it; an absent field leaves it alone. */
    email: z.string().max(320).nullable().optional(),
    notes: z.string().max(2_000).nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one field must be supplied",
  });

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  q: z.string().trim().min(1).optional(),
  sort: z.enum(["created", "-created"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export function toCustomerDto(customer: Customer) {
  return {
    id: customer.id,
    name: customer.name,
    email: customer.email ?? null,
    notes: customer.notes ?? null,
    createdAt: customer.createdAt.toISOString(),
    updatedAt: customer.updatedAt.toISOString(),
    version: customer.version,
  };
}

export interface CustomerDto extends ReturnType<typeof toCustomerDto> {}

export interface CustomerListResponse {
  readonly customers: readonly CustomerDto[];
}

export interface CustomerDetailResponse {
  readonly customer: CustomerDto;
  /**
   * The customer's completed order volume, in the currency of their first
   * completed order. A customer whose orders span more than one currency is
   * partial here — summed across currencies would be a number that means
   * nothing, so the first currency is reported and the rest are not.
   */
  readonly lifetimeValue: MoneyDto | null;
  readonly orders: readonly OrderDto[];
}
