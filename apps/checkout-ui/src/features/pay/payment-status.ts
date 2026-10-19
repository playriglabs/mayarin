import type { Deposit, PaymentStatusPayload } from "./types.ts";

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const CHAIN_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MACHINE_AMOUNT = /^\d+(\.\d+)?$/;

/**
 * The deposit the payer will send money to, or `undefined` while there is none
 * — and also when what arrived does not look like one. The payer copies this
 * address and amount into a wallet, so a value that is not an address, a chain
 * id or a plain decimal is never shown rather than shown as is (SEC-19).
 */
export function usableDeposit(payload: PaymentStatusPayload): Deposit | undefined {
  const deposit = payload.deposit ?? undefined;
  if (deposit === undefined) return undefined;
  const address = EVM_ADDRESS.test(deposit.address) || SOLANA_ADDRESS.test(deposit.address);
  const amounts = [deposit.amount, deposit.received].every((money) =>
    MACHINE_AMOUNT.test(money.formatted),
  );
  return address && amounts && CHAIN_ID.test(deposit.chain) ? deposit : undefined;
}
