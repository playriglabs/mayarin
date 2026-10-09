/**
 * Contract-call DTO mapper. Kept out of the DTO barrel on purpose: its input is
 * the API's own contract layer, and the barrel must reach pure packages only
 * (see `escrow-mapper.ts`).
 */

import { serializeMoney } from "@mayarin/shared";
import type { ContractCallView } from "../contract-layer.ts";
import type { ContractCallDto } from "./contract-call.ts";

export function toContractCallDto(view: ContractCallView): ContractCallDto {
  if (view.kind === "solana") {
    return {
      kind: "solana",
      chain: view.chain,
      paymentRouter: view.paymentRouter,
      order: {
        intentId: view.order.intentId,
        settlementToken: view.order.settlementToken,
        minOut: view.order.minOut.toString(),
        fee: view.order.fee.toString(),
        merchantSafe: view.order.merchantSafe,
        refundTo: view.order.refundTo,
        deadline: view.order.deadline.toString(),
      },
      signature: view.signature,
      preparationTransactions: view.preparationTransactions,
      transaction: view.transaction,
      payerEstimate: serializeMoney(view.payerEstimate),
      expiresAt: view.expiresAt.toISOString(),
    };
  }
  return {
    kind: "evm",
    chain: view.chain,
    chainId: view.chainId.toString(),
    paymentRouter: view.paymentRouter,
    order: {
      intentId: view.order.intentId,
      settlementToken: view.order.settlementToken,
      minOut: view.order.minOut.toString(),
      fee: view.order.fee.toString(),
      merchantSafe: view.order.merchantSafe,
      refundTo: view.order.refundTo,
      deadline: view.order.deadline.toString(),
    },
    signature: view.signature,
    route:
      view.route === null
        ? null
        : {
            router: view.route.router,
            callData: view.route.callData,
            expectedIn: serializeMoney(view.route.expectedIn),
            ...(view.route.expiresAt === undefined
              ? {}
              : { expiresAt: view.route.expiresAt.toISOString() }),
          },
    transaction:
      view.payEth === null
        ? null
        : {
            to: view.payEth.to,
            data: view.payEth.data,
            value: view.payEth.value.toString(),
          },
    payerEstimate: serializeMoney(view.payerEstimate),
    expiresAt: view.expiresAt.toISOString(),
  };
}
