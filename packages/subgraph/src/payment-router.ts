/**
 * PaymentRouter events, as entities.
 *
 * The mappings deliberately do almost nothing: they copy the log, derive the
 * one number that is not in it — headroom, the seconds an order had left when
 * it settled — and keep a per-network counter. Everything a caller might want
 * to average, rank or threshold is left to the caller, because a subgraph that
 * pre-computes a decision is a subgraph you have to redeploy to change your
 * mind about.
 */

import { BigInt, dataSource } from "@graphprotocol/graph-ts";
import { PaymentCompleted, ResidueRefunded } from "../generated/PaymentRouter/PaymentRouter";
import { Rail, Residue, Settlement } from "../generated/schema";

export function handlePaymentCompleted(event: PaymentCompleted): void {
  const settlement = new Settlement(event.transaction.hash.concatI32(event.logIndex.toI32()));

  settlement.intentId = event.params.intentId;
  settlement.logIndex = event.logIndex.toI32();
  settlement.blockHash = event.block.hash;
  settlement.merchantSafe = event.params.merchantSafe;
  settlement.refundTo = event.params.refundTo;
  settlement.inputAsset = event.params.inputAsset;
  settlement.settlementAsset = event.params.settlementAsset;
  settlement.inputAmount = event.params.inputAmount;
  settlement.settledAmount = event.params.settledAmount;
  settlement.fee = event.params.fee;
  settlement.refundAmount = event.params.refundAmount;
  settlement.deadline = event.params.deadline;
  // The contract reverts once `block.timestamp > deadline`, so this is never
  // negative on a log that exists.
  settlement.headroomSeconds = event.params.deadline.minus(event.block.timestamp);
  settlement.blockNumber = event.block.number;
  settlement.blockTimestamp = event.block.timestamp;
  settlement.transactionHash = event.transaction.hash;
  settlement.save();

  const rail = railOf();
  rail.settlements = rail.settlements.plus(BigInt.fromI32(1));
  rail.totalSettled = rail.totalSettled.plus(event.params.settledAmount);
  rail.lastSettlementAt = event.block.timestamp;
  rail.lastHeadroomSeconds = settlement.headroomSeconds;
  rail.save();
}

export function handleResidueRefunded(event: ResidueRefunded): void {
  const residue = new Residue(event.transaction.hash.concatI32(event.logIndex.toI32()));

  residue.intentId = event.params.intentId;
  residue.logIndex = event.logIndex.toI32();
  residue.blockHash = event.block.hash;
  residue.asset = event.params.asset;
  residue.to = event.params.to;
  residue.amount = event.params.amount;
  residue.blockNumber = event.block.number;
  residue.blockTimestamp = event.block.timestamp;
  residue.transactionHash = event.transaction.hash;
  residue.save();
}

/** The running total for the network this deployment indexes. */
function railOf(): Rail {
  const network = dataSource.network();
  let rail = Rail.load(network);
  if (rail != null) return rail;

  rail = new Rail(network);
  rail.settlements = BigInt.zero();
  rail.totalSettled = BigInt.zero();
  rail.lastSettlementAt = BigInt.zero();
  rail.lastHeadroomSeconds = BigInt.zero();
  return rail;
}
