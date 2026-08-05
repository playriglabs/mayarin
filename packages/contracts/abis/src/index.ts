/**
 * `@mayarin/contracts` — typed Solidity ABI + domain types for the on-chain
 * PaymentRouter (RFC #4). The ABI is generated from the Foundry artifact; the
 * `Order` and `PaymentCompleted` types mirror the on-chain struct/event so
 * downstream RFCs (#5 calldata, #6 order signing, #8 event ingestion) stay
 * compile-checked against the contract.
 */
export { paymentRouterAbi } from "./abi.js";
export type { Order, PaymentCompletedArgs, PaymentCompletedEvent } from "./types.js";
