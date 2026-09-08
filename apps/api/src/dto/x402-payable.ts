/**
 * The public x402 payable index wire shape (#273).
 *
 * What an agent reads before it has met anyone: one row per obligation a
 * merchant has chosen to list. The entry carries the price a `402` on it
 * would quote — an invoice's outstanding balance, a link's total — because a
 * discovery reader deciding *whether* to pay should not have to ask each one
 * to find out.
 *
 * OpenAPI imports these schemas, so they are defined once here rather than
 * inlined in the route.
 */

import { ValidationError } from "@mayarin/shared";
import { isPayableKind } from "@mayarin/x402";
import type { PayableListCursor, PayableListEntry } from "../services/x402-payables.ts";
import { toMoneyDto } from "./money.ts";

export function toPayableEntryDto(entry: PayableListEntry): Record<string, unknown> {
  return {
    kind: entry.kind,
    id: entry.id,
    createdAt: entry.createdAt.toISOString(),
    merchant: entry.merchant,
    ...(entry.title === undefined ? {} : { title: entry.title }),
    amount: toMoneyDto(entry.amount),
    url: entry.url,
    ...(entry.dueAt === undefined ? {} : { dueAt: entry.dueAt.toISOString() }),
  };
}

/**
 * The cursor is the last entry's own `{kind, id, createdAt}` — the same keys
 * the index is ordered by, so the next page resumes without skipping or
 * repeating. Base64url, like the dashboard's cursors, and opaque on purpose:
 * a client that could read it would depend on it.
 */
export function encodePayableCursor(cursor: PayableListCursor): string {
  const json = JSON.stringify({
    kind: cursor.kind,
    id: cursor.id,
    createdAt: cursor.createdAt.toISOString(),
  });
  return btoa(json).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function decodePayableCursor(value: string | undefined): PayableListCursor | undefined {
  if (value === undefined) return undefined;
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const json = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const parsed: unknown = JSON.parse(json);
    if (parsed === null || typeof parsed !== "object") throw new Error("invalid cursor");
    const row = parsed as Record<string, unknown>;
    if (typeof row.kind !== "string" || !isPayableKind(row.kind)) {
      throw new Error("invalid cursor");
    }
    if (typeof row.id !== "string" || typeof row.createdAt !== "string") {
      throw new Error("invalid cursor");
    }
    const createdAt = new Date(row.createdAt);
    if (Number.isNaN(createdAt.getTime())) throw new Error("invalid cursor");
    return { kind: row.kind, id: row.id, createdAt };
  } catch {
    throw new ValidationError("Invalid pagination cursor");
  }
}
