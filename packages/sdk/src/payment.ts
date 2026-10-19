import type {
  ClearingDto,
  ContractCallDto,
  CreatePaymentIntentBody,
  EscrowDto,
  PaymentDto,
  PaymentIntentDto,
} from "@mayarin/api/dto";
import type { RequestOptions, Transport } from "./transport.ts";

/**
 * What creating an intent returns: the intent, and the buyer's way into it.
 * `checkoutUrl` is the hosted payment page with the payer's token attached
 * (SEC-09); a payment id alone opens nothing.
 */
export interface CreatedPaymentIntent extends PaymentIntentDto {
  readonly payerToken: string;
  readonly checkoutUrl: string;
}

export interface PaymentModule {
  readonly createIntent: (
    body: CreatePaymentIntentBody,
    options?: RequestOptions,
  ) => Promise<CreatedPaymentIntent>;
  readonly getIntent: (id: string, options?: RequestOptions) => Promise<PaymentIntentDto>;
  readonly confirmIntent: (id: string, options?: RequestOptions) => Promise<PaymentDto>;
  readonly get: (id: string, options?: RequestOptions) => Promise<PaymentDto>;
  readonly getContractCall: (id: string, options?: RequestOptions) => Promise<ContractCallDto>;
  /**
   * Where an escrowed payment's funds are, and the calldata to release, refund
   * or dispute them (#304). Send `calls[action]` to `factory` from the wallet
   * the terms allow.
   */
  readonly getEscrow: (id: string, options?: RequestOptions) => Promise<EscrowDto>;
  /** Reopen a failed payment whose payer funds were already received. */
  readonly retry: (id: string, options?: RequestOptions) => Promise<ClearingDto>;
}

export function createPaymentModule(transport: Transport): PaymentModule {
  return {
    createIntent: async (body, options) => {
      const { paymentIntent, payerToken, checkoutUrl } = await transport.post<{
        paymentIntent: PaymentIntentDto;
        payerToken: string;
        checkoutUrl: string;
      }>("/payment-intents", body, options);
      return { ...paymentIntent, payerToken, checkoutUrl };
    },
    getIntent: async (id, options) => {
      const response = await transport.get<{ paymentIntent: PaymentIntentDto }>(
        `/payment-intents/${encodeURIComponent(id)}`,
        options,
      );
      return response.paymentIntent;
    },
    confirmIntent: (id, options) =>
      transport.post(`/payment-intents/${encodeURIComponent(id)}/confirm`, undefined, options),
    get: (id, options) => transport.get(`/payments/${encodeURIComponent(id)}`, options),
    getContractCall: (id, options) =>
      transport.get(`/payments/${encodeURIComponent(id)}/contract-call`, options),
    getEscrow: async (id, options) => {
      const response = await transport.get<{ escrow: EscrowDto }>(
        `/payments/${encodeURIComponent(id)}/escrow`,
        options,
      );
      return response.escrow;
    },
    retry: async (id, options) => {
      const response = await transport.post<{ clearing: ClearingDto }>(
        `/payments/${encodeURIComponent(id)}/retry`,
        undefined,
        options,
      );
      return response.clearing;
    },
  };
}
