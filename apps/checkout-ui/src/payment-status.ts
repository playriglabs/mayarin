import type { PaymentStatusPayload } from "./types.ts";

type Deposit = NonNullable<PaymentStatusPayload["deposit"]>;

export function usableDeposit(payload: PaymentStatusPayload): Deposit | undefined {
  return payload.deposit ?? undefined;
}
