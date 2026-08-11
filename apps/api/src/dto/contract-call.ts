/**
 * Wire shape of the contract-path submit payload (#61).
 *
 * Every bigint travels as a decimal string — the wire carries no number that
 * could round. `transaction` is the ready `payEth` call for a native payer;
 * an ERC-20 payer assembles `payERC20` client-side, because only their
 * wallet can sign the Permit2 authorisation.
 */

import { serializeMoney } from "@mayarin/shared";
import type { ContractCallView } from "../contract-layer.ts";

export function toContractCallDto(view: ContractCallView) {
  return {
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

export type ContractCallDto = ReturnType<typeof toContractCallDto>;
