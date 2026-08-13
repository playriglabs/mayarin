/**
 * Status in the payer's own terms.
 *
 * A payer does not know what PROCESSING means, and the machine's own names are
 * the wrong vocabulary for the one screen where somebody is deciding whether
 * their money arrived.
 */

export type Tone = "live" | "done" | "bad" | "";

export const TERMINAL_STATUSES: readonly string[] = ["COMPLETED", "FAILED", "EXPIRED"];

const WORDING: Readonly<Record<string, readonly [string, Tone]>> = {
  PENDING: ["menunggu pembayaran", "live"],
  CONFIRMED: ["dana terdeteksi", "live"],
  PROCESSING: ["sedang diproses", "live"],
  COMPLETED: ["pembayaran selesai", "done"],
  FAILED: ["pembayaran gagal", "bad"],
  EXPIRED: ["masa berlaku habis", "bad"],
};

export function statusWording(status: string): readonly [string, Tone] {
  return WORDING[status] ?? [status.toLowerCase(), ""];
}

export function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.includes(status);
}
