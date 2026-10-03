/**
 * Escrow keeper (#304): closes escrows whose time has come.
 *
 * `EscrowFactory` lets anyone release an undisputed escrow once its hold ends,
 * and lets anyone refund a dispute nobody decided by `resolveBy`. "Anyone"
 * still has to send the transaction, so this does — with the operator key,
 * through the treasury executor's nonce lock, which only pays the gas: where
 * the funds go is fixed by the terms, and the contract refuses a call the terms
 * do not allow.
 *
 * Idempotent. Each pass reads the escrow from the chain first, so an escrow the
 * payer, the merchant or the arbiter already closed — or one this keeper closed
 * before crashing — is recorded, not moved again.
 */

import type { ChainId } from "@mayarin/chain";
import type { ContractOrder } from "@mayarin/clearing";
import type { DueEscrow } from "@mayarin/db";
import {
  type EscrowState,
  type EscrowTerms,
  escrowCalldata,
  readEscrowState,
} from "@mayarin/provider-evm";
import type { Clock } from "@mayarin/shared";
import { createPublicClient, http, type PublicClient } from "viem";
import {
  alertDue,
  type DisputeAlertSink,
  type DisputeNotifier,
  disputeOf,
  type EscrowDisputeLog,
} from "./escrow-dispute.ts";

export interface EscrowKeeperRepository {
  listDueEscrows(nowSeconds: number, limit: number): Promise<DueEscrow[]>;
  markEscrowOutcome(
    clearingTransactionId: string,
    outcome: EscrowClosed,
    closedAt: Date,
  ): Promise<void>;
}

export interface EscrowKeeperOptions {
  readonly repository: EscrowKeeperRepository;
  /** Reads an escrow's state; `undefined` when this chain cannot be read. */
  readonly read: EscrowStateReader;
  /** Sends one call from the operator and waits for it; throws on a revert. */
  readonly send: (chain: ChainId, to: string, data: `0x${string}`) => Promise<string>;
  /** The dispute case files (#313): opened when the chain shows a dispute, closed with the escrow. */
  readonly disputes: EscrowDisputeLog;
  /** Where a dispute nearing `resolveBy` is announced. */
  readonly alert: DisputeAlertSink;
  /** Tells the merchant about a dispute this pass found first (#313). */
  readonly notifier: DisputeNotifier;
  /** Tells the merchant they got paid when an escrow releases undisputed; absent without email. */
  readonly paid?: { released(clearingTransactionId: string): Promise<void> };
  readonly clock: Clock;
  readonly batchSize?: number;
}

export type EscrowKeeperAction = "release" | "refund";

/** How an escrow ended: whole to one side, or split by the arbiter (#315). */
export type EscrowClosed = "released" | "refunded" | "split";

export type EscrowStateReader = (
  chain: ChainId,
  terms: EscrowTerms,
  token: string,
  factory: string,
) => Promise<EscrowState | undefined>;

/** Reads escrow state over each chain's RPC, one client per chain. */
export function rpcEscrowStateReader(
  rpcUrls: Readonly<Partial<Record<ChainId, string>>>,
): EscrowStateReader {
  const clients = new Map<ChainId, PublicClient>();
  return async (chain, terms, token, factory) => {
    const rpcUrl = rpcUrls[chain];
    if (rpcUrl === undefined) return undefined;
    let client = clients.get(chain);
    if (client === undefined) {
      client = createPublicClient({ transport: http(rpcUrl) });
      clients.set(chain, client);
    }
    return readEscrowState(client, terms, token, factory);
  };
}

export class EscrowKeeper {
  readonly #options: EscrowKeeperOptions;

  constructor(options: EscrowKeeperOptions) {
    this.#options = options;
  }

  /** One pass. Returns what it did, for logs and tests. */
  async tick(): Promise<readonly { id: string; action: EscrowKeeperAction | "recorded" }[]> {
    const nowSeconds = Math.floor(this.#options.clock.now().getTime() / 1_000);
    const due = await this.#options.repository.listDueEscrows(
      nowSeconds,
      this.#options.batchSize ?? 25,
    );
    const done: { id: string; action: EscrowKeeperAction | "recorded" }[] = [];

    for (const escrow of due) {
      try {
        const action = await this.#close(escrow, BigInt(nowSeconds));
        if (action !== undefined) done.push({ id: escrow.clearingTransactionId, action });
      } catch (error) {
        // One escrow's failure must not hold up the rest; it is retried next pass.
        console.error(
          `[escrow-keeper] ${escrow.clearingTransactionId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    await this.#alert();
    return done;
  }

  /** Warns about open disputes nearing `resolveBy`, each threshold once (#313). */
  async #alert(): Promise<void> {
    const now = this.#options.clock.now();
    for (const dispute of await this.#options.disputes.listOpen()) {
      const alert = alertDue(dispute, now);
      if (alert === undefined) continue;
      try {
        await this.#options.alert(
          `Dispute on ${dispute.paymentIntentId} is undecided with ${alert === "24h" ? "under 24 hours" : "under 48 hours"} left — it refunds the payer at ${dispute.resolveBy.toISOString()}.`,
        );
        await this.#options.disputes.markAlerted(dispute.id, alert);
      } catch (error) {
        console.error(
          `[escrow-keeper] alert for ${dispute.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  async #close(
    { clearingTransactionId, paymentIntentId, merchantId, chain, order }: DueEscrow,
    now: bigint,
  ): Promise<EscrowKeeperAction | "recorded" | undefined> {
    const escrow = order.escrow;
    if (escrow === undefined) return undefined;

    const terms = termsOf(order);
    const state = await this.#options.read(chain, terms, order.settlementToken, escrow.factory);
    if (state === undefined) return undefined;

    if (state.outcome !== "held") {
      await this.#recordOutcome(clearingTransactionId, paymentIntentId, state.outcome);
      return "recorded";
    }
    // A dispute nobody reported yet still gets its case file, so the arbiter
    // sees it while there is time left to decide.
    if (state.disputed) {
      const { dispute, opened } = await this.#options.disputes.open(
        disputeOf(order, { paymentIntentId, merchantId, chain }),
        this.#options.clock.now(),
      );
      if (opened) await this.#options.notifier.opened(dispute);
    }
    // Nothing to move yet; the next pass looks again.
    if (state.balance === 0n) return undefined;

    const action: EscrowKeeperAction | undefined = !state.disputed
      ? "release"
      : now >= escrow.resolveBy
        ? "refund"
        : undefined;
    if (action === undefined) return undefined;

    const hash = await this.#options.send(
      chain,
      escrow.factory,
      escrowCalldata(action, terms, order.settlementToken),
    );

    await this.#recordOutcome(
      clearingTransactionId,
      paymentIntentId,
      action === "release" ? "released" : "refunded",
    );
    console.log(`[escrow-keeper] ${action} ${clearingTransactionId} in ${hash}`);
    return action;
  }

  async #recordOutcome(
    clearingTransactionId: string,
    paymentIntentId: string,
    outcome: EscrowClosed,
  ): Promise<void> {
    const now = this.#options.clock.now();
    await this.#options.repository.markEscrowOutcome(clearingTransactionId, outcome, now);
    await this.#options.disputes.close(paymentIntentId, outcome, now);
    // A disputed release is the arbiter's decision, told through the dispute;
    // only a hold that ran out quietly is "you got paid".
    if (
      outcome === "released" &&
      (await this.#options.disputes.findByPaymentIntentId(paymentIntentId)) === undefined
    ) {
      await this.#options.paid?.released(clearingTransactionId);
    }
  }
}

function termsOf(order: ContractOrder): EscrowTerms {
  const escrow = order.escrow;
  if (escrow === undefined) throw new Error("Order carries no escrow");
  return {
    intentId: order.intentId as `0x${string}`,
    payer: escrow.payer,
    payee: escrow.payee,
    arbiter: escrow.arbiter,
    releaseAfter: escrow.releaseAfter,
    resolveBy: escrow.resolveBy,
    ...(escrow.bond === undefined ? {} : { bond: escrow.bond }),
  };
}

/**
 * Runs the keeper every `intervalMs` until stopped. A failed pass is logged and
 * the next one runs on schedule — closing an escrow late is harmless, since the
 * contract only ever allows the move the terms already decided.
 */
export function startEscrowKeeper(keeper: EscrowKeeper, intervalMs = 60_000): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const run = async (): Promise<void> => {
    try {
      const done = await keeper.tick();
      if (done.length > 0) console.log(`[escrow-keeper] closed ${done.length} escrow(s)`);
    } catch (error) {
      console.error(
        `[escrow-keeper] pass failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!stopped) timer = setTimeout(() => void run(), intervalMs);
  };

  void run();
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}
