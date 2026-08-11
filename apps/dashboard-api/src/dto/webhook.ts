/**
 * Webhook request schemas and response DTOs (#13).
 *
 * No route here takes a merchant id: the merchant is the one on the session,
 * and a field that cannot be sent cannot be forged.
 */

import type { WebhookDelivery, WebhookEndpoint } from "@mayarin/notifications";
import { z } from "zod";

export const createEndpointBodySchema = z
  .object({
    url: z.string().url(),
  })
  .strict();

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  q: z.string().trim().min(1).optional(),
  status: z.enum(["PENDING", "DELIVERED", "DEAD"]).optional(),
  sort: z.enum(["created", "-created"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.string().min(1).optional(),
});

/** The listing shape. Secrets never appear here — only creation and rotation show one. */
export function toEndpointDto(endpoint: WebhookEndpoint) {
  return {
    id: endpoint.id,
    url: endpoint.url,
    active: endpoint.active,
    /** True while a rotated-out secret is still accepted, so a merchant can see the overlap. */
    rotatedSecretActive: endpoint.previousSecret !== undefined,
    createdAt: endpoint.createdAt.toISOString(),
    updatedAt: endpoint.updatedAt.toISOString(),
  };
}

export function toDeliveryDto(delivery: WebhookDelivery) {
  return {
    id: delivery.id,
    eventId: delivery.eventId,
    endpointId: delivery.endpointId,
    status: delivery.status,
    attempts: delivery.attempts,
    /** What the receiver answered, which is what a merchant debugging needs first. */
    lastStatusCode: delivery.lastStatusCode ?? null,
    lastError: delivery.lastError ?? null,
    nextAttemptAt: delivery.nextAttemptAt.toISOString(),
    deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
    /** The exact bytes that were signed and sent, so a merchant can verify locally. */
    body: delivery.body,
    createdAt: delivery.createdAt.toISOString(),
  };
}
