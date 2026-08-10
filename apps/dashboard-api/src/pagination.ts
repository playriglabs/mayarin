import { ValidationError } from "@mayarin/shared";

export const DEFAULT_PAGE_SIZE = 7;

export interface ListCursor {
  readonly id: string;
  readonly createdAt: Date;
  readonly amount?: bigint;
}

export interface CursorPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export function cursorPage<T>(
  rows: readonly T[],
  limit: number,
  cursorOf: (row: T) => ListCursor,
): CursorPage<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last !== undefined ? encodeCursor(cursorOf(last)) : null,
  };
}

export function encodeCursor(cursor: ListCursor): string {
  const json = JSON.stringify({
    id: cursor.id,
    createdAt: cursor.createdAt.toISOString(),
    ...(cursor.amount === undefined ? {} : { amount: cursor.amount.toString() }),
  });
  return btoa(json).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function decodeCursor(value: string | undefined): ListCursor | undefined {
  if (value === undefined) return undefined;
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const json = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const parsed: unknown = JSON.parse(json);
    if (parsed === null || typeof parsed !== "object") throw new Error("invalid cursor");
    const row = parsed as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.createdAt !== "string") {
      throw new Error("invalid cursor");
    }
    const createdAt = new Date(row.createdAt);
    if (Number.isNaN(createdAt.getTime())) throw new Error("invalid cursor");
    if (row.amount !== undefined && typeof row.amount !== "string")
      throw new Error("invalid cursor");
    return {
      id: row.id,
      createdAt,
      ...(typeof row.amount === "string" ? { amount: BigInt(row.amount) } : {}),
    };
  } catch {
    throw new ValidationError("Invalid pagination cursor");
  }
}
