/**
 * Clearing state machine.
 *
 * The transition table is the contract: no code path may move a transaction in
 * a way this table does not allow, and every non-terminal state has exactly one
 * forward step, which is what makes a transaction resumable from whatever state
 * it was persisted in.
 */

import { InvalidStateTransitionError } from "@mayarin/shared";
import type { ClearingState, ClearingTransaction } from "./types.ts";

const TRANSITIONS: Readonly<Record<ClearingState, readonly ClearingState[]>> = {
  CREATED: ["QR_PARSED", "FAILED"],
  QR_PARSED: ["PRICE_LOCKED", "FAILED"],
  PRICE_LOCKED: ["PAYMENT_PENDING", "FAILED"],
  PAYMENT_PENDING: ["ASSET_RECEIVED", "FAILED"],
  ASSET_RECEIVED: ["CLEARING", "FAILED"],
  CLEARING: ["SETTLING", "FAILED"],
  SETTLING: ["SETTLED", "FAILED"],
  SETTLED: ["SUCCESS"],
  SUCCESS: [],
  FAILED: [],
};

export const TERMINAL_CLEARING_STATES: readonly ClearingState[] = ["SUCCESS", "FAILED"];

/** The single forward step from each state. `undefined` for terminal states. */
const NEXT_STATE: Readonly<Record<ClearingState, ClearingState | undefined>> = {
  CREATED: "QR_PARSED",
  QR_PARSED: "PRICE_LOCKED",
  PRICE_LOCKED: "PAYMENT_PENDING",
  PAYMENT_PENDING: "ASSET_RECEIVED",
  ASSET_RECEIVED: "CLEARING",
  CLEARING: "SETTLING",
  SETTLING: "SETTLED",
  SETTLED: "SUCCESS",
  SUCCESS: undefined,
  FAILED: undefined,
};

export function canTransition(from: ClearingState, to: ClearingState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function nextState(from: ClearingState): ClearingState | undefined {
  return NEXT_STATE[from];
}

export function isTerminalState(state: ClearingState): boolean {
  return TERMINAL_CLEARING_STATES.includes(state);
}

export function isTerminal(transaction: ClearingTransaction): boolean {
  return isTerminalState(transaction.state);
}

export function assertTransition(transaction: ClearingTransaction, to: ClearingState): void {
  if (!canTransition(transaction.state, to)) {
    throw new InvalidStateTransitionError(
      `Clearing transaction ${transaction.id} cannot move from ${transaction.state} to ${to}`,
      { id: transaction.id, from: transaction.state, to },
    );
  }
}
