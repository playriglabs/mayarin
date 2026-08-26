import type { Deposit, PaymentStatusPayload } from "./types.ts";

export function usableDeposit(payload: PaymentStatusPayload): Deposit | undefined {
  return payload.deposit ?? undefined;
}
