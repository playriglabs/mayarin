/** Railway entry point for continuous chain ingestion. */

import { CHAIN_IDS } from "@mayarin/chain";
import { acquireWorkerLease, CHAIN_WORKER_FENCE } from "@mayarin/db";
import { initErrorReporting } from "@mayarin/observability";
import { ConfigurationError } from "@mayarin/shared";
import { loadConfig } from "./config.ts";
import { createContainer, watchedPairs } from "./container.ts";
import { startEscrowKeeper } from "./services/escrow-keeper.ts";
import { alertSender, createStuckPaymentCheck } from "./services/stuck-payments.ts";
import { startIndexerLoops, startWatcherLoops } from "./services/watcher-loops.ts";

initErrorReporting("chain-worker");

const config = loadConfig(process.env, "worker");
const chain = config.chain;

if (chain === undefined || chain.intervalMs <= 0) {
  throw new ConfigurationError(
    "The chain worker needs CHAIN_ENABLED=true and WATCHER_INTERVAL_MS greater than zero",
    {},
  );
}

// One worker at a time, enforced by the database. A second instance waits here
// until the first is gone instead of racing it on nonces and cursors.
const lease = await acquireWorkerLease(config.databaseUrl, {
  onWaiting: () => console.log("[chain-worker] another worker holds the lease; waiting"),
  // Without the lease a second worker may be running; stop and let the platform restart.
  onLost: () => {
    console.error("[chain-worker] lost the worker lease; exiting");
    process.exit(1);
  },
});

const container = createContainer({
  config,
  fence: { name: CHAIN_WORKER_FENCE, token: lease.fencingToken },
});

const seeded = await container.market.seedFromEnvironment();
if (seeded.length > 0) {
  console.log(`[chain-worker] seeded market config: ${seeded.join(", ")}`);
}

await container.walletGuard.assertTreasuryUnclaimed(CHAIN_IDS);

const recovered = await container.engine.resumeStuck();
if (recovered.length > 0) {
  console.log(`[chain-worker] resumed ${recovered.length} clearing transaction(s)`);
}

// A payment parks at a step the process that recorded its receipt cannot run:
// core-api has no treasury executor, so a deposit it records stops at
// ASSET_RECEIVED. Resuming only at start left such a payment waiting for the next
// deploy; this worker holds the executor, so it picks them up as they appear.
// Every step is keyed per state and the writes are version-checked, and the engine
// skips a payment this process is already stepping: a pass that waits on a
// transaction's confirmations is not entered a second time by this timer.
const RESUME_INTERVAL_MS = 30_000;
let resuming = false;
const resumeTimer = setInterval(() => {
  if (resuming) return;
  resuming = true;
  void container.engine
    .resumeStuck()
    .then((resumed) => {
      if (resumed.length > 0) {
        console.log(`[chain-worker] resumed ${resumed.length} clearing transaction(s)`);
      }
      for (const progress of resumed) {
        if (progress.retryableFailure !== undefined) {
          console.warn(
            `[chain-worker] ${progress.transaction.id} not advanced: ${progress.retryableFailure}`,
          );
        }
      }
    })
    .catch((error: unknown) => console.error("[chain-worker] resume pass failed", error))
    .finally(() => {
      resuming = false;
    });
}, RESUME_INTERVAL_MS);

// A payer who has paid and a merchant who has not been paid, ten minutes on, is
// worth a person's attention; the API's /health stays green while this happens.
const STUCK_PAYMENT_INTERVAL_MS = 60_000;
const checkStuckPayments = createStuckPaymentCheck({
  list: () => container.engine.listResumable(),
  now: () => new Date(),
  send: alertSender(
    config.telegramBotToken !== undefined && config.telegramChatId !== undefined
      ? { botToken: config.telegramBotToken, chatId: config.telegramChatId }
      : undefined,
  ),
});
let checkingStuck = false;
const stuckPaymentTimer = setInterval(() => {
  if (checkingStuck) return;
  checkingStuck = true;
  void checkStuckPayments()
    .catch((error: unknown) => console.error("[chain-worker] stuck payment check failed", error))
    .finally(() => {
      checkingStuck = false;
    });
}, STUCK_PAYMENT_INTERVAL_MS);

// A failed deposit goes back to the address the payer named, after the grace
// period in which a person can still retry the payment. Slower than the resume
// pass: a return waits on chain confirmations and is not urgent.
const DEPOSIT_RETURN_INTERVAL_MS = 60_000;
let returningDeposits = false;
// A payment that stays "no-address" or "needs-review" is reported once, not every minute.
const lastReturnOutcome = new Map<string, string>();
const depositReturnTimer =
  container.depositReturns === undefined
    ? undefined
    : setInterval(() => {
        if (returningDeposits) return;
        returningDeposits = true;
        void container.depositReturns
          ?.returnPending()
          .then((results) => {
            for (const { transaction, outcome, detail } of results) {
              if (lastReturnOutcome.get(transaction.id) === outcome) continue;
              lastReturnOutcome.set(transaction.id, outcome);
              console.log(
                `[chain-worker] deposit return ${transaction.id}: ${outcome}${detail === undefined ? "" : ` (${detail})`}`,
              );
            }
          })
          .catch((error: unknown) => console.error("[chain-worker] deposit return failed", error))
          .finally(() => {
            returningDeposits = false;
          });
      }, DEPOSIT_RETURN_INTERVAL_MS);

const finishedRefunds = await container.refunds.resumePending();
if (finishedRefunds.length > 0) {
  console.log(`[chain-worker] finished ${finishedRefunds.length} pending refund(s)`);
}

// A refund can crash between "rail confirmed" and "ledger posted" while the
// worker keeps running; finishing it only at start would leave it pending until
// the next restart. Same call, on a timer, with no overlap (SEC-02).
const REFUND_RECOVERY_INTERVAL_MS = 5 * 60_000;
/** Reconciliation looks back this far each time; older refunds were checked many times already. */
const REFUND_RECONCILE_WINDOW_MS = 7 * 24 * 60 * 60_000;
// What the operator key sent and what became of it (SEC-04). A stuck transaction
// is replaced with higher fees a bounded number of times; the rest is reported.
const OPERATOR_RECONCILE_INTERVAL_MS = 60_000;
let reconcilingOperator = false;
const operatorReconcileTimer = setInterval(() => {
  if (reconcilingOperator) return;
  reconcilingOperator = true;
  void container.operatorTransactions
    .run()
    .then((findings) => {
      for (const finding of findings) console.error(JSON.stringify(finding));
    })
    .catch((error: unknown) => console.error("[chain-worker] operator reconcile failed", error))
    .finally(() => {
      reconcilingOperator = false;
    });
}, OPERATOR_RECONCILE_INTERVAL_MS);

// What the operator holds against its limits (SEC-06). Reports a balance above
// its ceiling or native currency under its floor; it moves nothing.
const OPERATOR_FLOAT_INTERVAL_MS = 5 * 60_000;
let checkingFloat = false;
const operatorFloatTimer =
  container.operatorFloat === undefined
    ? undefined
    : setInterval(() => {
        if (checkingFloat) return;
        checkingFloat = true;
        void container.operatorFloat
          ?.run()
          .then((findings) => {
            for (const finding of findings) console.error(JSON.stringify(finding));
          })
          .catch((error: unknown) =>
            console.error("[chain-worker] operator float check failed", error),
          )
          .finally(() => {
            checkingFloat = false;
          });
      }, OPERATOR_FLOAT_INTERVAL_MS);

// Tops the operator's native gas up from the treasury Safe's allowance when it is
// under its floor. One chain at a time on this worker only, so it never races the
// executor's nonces; every pass reads the chain, so a crash between pull and swap
// resumes at the swap.
const GAS_REFILL_INTERVAL_MS = 5 * 60_000;
let refillingGas = false;
const gasRefillTimer =
  container.gasRefiller === undefined
    ? undefined
    : setInterval(() => {
        if (refillingGas) return;
        refillingGas = true;
        void container.gasRefiller
          ?.run()
          .then((findings) => {
            for (const finding of findings) console.error(JSON.stringify(finding));
          })
          .catch((error: unknown) => console.error("[chain-worker] gas refill failed", error))
          .finally(() => {
            refillingGas = false;
          });
      }, GAS_REFILL_INTERVAL_MS);

// Funds that reached a deposit address after its payment expired: money with no
// payment to settle. Reported once per payment per process.
const LATE_DEPOSIT_INTERVAL_MS = 5 * 60_000;
const reportedLate = new Set<string>();
let checkingLate = false;
const lateDepositTimer =
  container.lateDeposits === undefined
    ? undefined
    : setInterval(() => {
        if (checkingLate) return;
        checkingLate = true;
        void container.lateDeposits
          ?.list()
          .then((late) => {
            for (const item of late) {
              if (reportedLate.has(item.clearingTransactionId)) continue;
              reportedLate.add(item.clearingTransactionId);
              console.error(
                JSON.stringify({
                  type: "late-deposit",
                  paymentIntentId: item.paymentIntentId,
                  clearingTransactionId: item.clearingTransactionId,
                  chain: item.chain,
                  address: item.address,
                  required: item.required.amount.toString(),
                  received: item.received.amount.toString(),
                  asset: item.required.asset,
                  expiredAt: item.expiredAt.toISOString(),
                }),
              );
            }
          })
          .catch((error: unknown) =>
            console.error("[chain-worker] late deposit check failed", error),
          )
          .finally(() => {
            checkingLate = false;
          });
      }, LATE_DEPOSIT_INTERVAL_MS);

let recoveringRefunds = false;
const refundRecoveryTimer = setInterval(() => {
  if (recoveringRefunds) return;
  recoveringRefunds = true;
  void container.refunds
    .resumePending()
    .then((finished) => {
      if (finished.length > 0) {
        console.log(`[chain-worker] finished ${finished.length} pending refund(s)`);
      }
    })
    .catch((error: unknown) => console.error("[chain-worker] refund recovery failed", error))
    // After recovery, so a refund it just finished is not reported as unposted.
    .then(() => container.refunds.reconcile(new Date(Date.now() - REFUND_RECONCILE_WINDOW_MS)))
    .then((discrepancies) => {
      for (const discrepancy of discrepancies) {
        console.error(
          JSON.stringify(
            { type: "refund-discrepancy", ...discrepancy, amounts: undefined },
            (_k, v) => (typeof v === "bigint" ? v.toString() : v),
          ),
        );
      }
    })
    .catch((error: unknown) => console.error("[chain-worker] refund reconciliation failed", error))
    .finally(() => {
      recoveringRefunds = false;
    });
}, REFUND_RECOVERY_INTERVAL_MS);

const pairs = watchedPairs(config);
if (pairs.length === 0 && container.indexers.size === 0) {
  await container.close();
  throw new ConfigurationError("The chain worker has no watcher pairs or settlement indexers", {});
}

const stopWatcherLoops = startWatcherLoops({
  pairs,
  watchers: container.watchers,
  intervalMs: chain.intervalMs,
  catchUpIntervalMs: chain.catchUpIntervalMs,
  rangeOf: (pair) =>
    config.chainNativeAssets[pair.chain] === pair.asset ? chain.nativeBlockRange : chain.blockRange,
});
const stopIndexerLoops = startIndexerLoops({
  indexers: container.indexers,
  intervalMs: chain.indexerIntervalMs,
  catchUpIntervalMs: chain.catchUpIntervalMs,
  maxBackoffMs: chain.indexerMaxBackoffMs,
});

// Releases an escrow once its hold ends, and refunds a dispute nobody decided
// by `resolveBy` (#304). Needs the operator key, so only with treasury execution.
const stopEscrowKeeper =
  container.escrowKeeper === undefined ? () => {} : startEscrowKeeper(container.escrowKeeper);

console.log(
  `[chain-worker] watching ${pairs.length} chain/asset pair(s) and ${container.indexers.size} router(s)`,
);

let stopping = false;
const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  if (stopping) return;
  stopping = true;
  console.log(`[chain-worker] received ${signal}; stopping`);
  stopWatcherLoops();
  stopIndexerLoops();
  stopEscrowKeeper();
  clearInterval(refundRecoveryTimer);
  clearInterval(operatorReconcileTimer);
  clearInterval(operatorFloatTimer);
  clearInterval(gasRefillTimer);
  clearInterval(resumeTimer);
  clearInterval(stuckPaymentTimer);
  if (depositReturnTimer !== undefined) clearInterval(depositReturnTimer);
  clearInterval(lateDepositTimer);
  await container.close();
  await lease.release();
  process.exit(0);
};

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
