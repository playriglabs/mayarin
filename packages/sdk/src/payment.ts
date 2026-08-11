import type {
  ContractCallDto,
  CreatePaymentIntentBody,
  PaymentDto,
  PaymentIntentDto,
} from "@mayarin/api/dto";
import type { RequestOptions, Transport } from "./transport.ts";

export interface PaymentModule {
  readonly createIntent: (
    body: CreatePaymentIntentBody,
    options?: RequestOptions,
  ) => Promise<PaymentIntentDto>;
  readonly getIntent: (id: string, options?: RequestOptions) => Promise<PaymentIntentDto>;
  readonly confirmIntent: (id: string, options?: RequestOptions) => Promise<PaymentDto>;
  readonly get: (id: string, options?: RequestOptions) => Promise<PaymentDto>;
  readonly getContractCall: (id: string, options?: RequestOptions) => Promise<ContractCallDto>;
}

export function createPaymentModule(transport: Transport): PaymentModule {
  return {
    createIntent: async (body, options) => {
      const response = await transport.post<{ paymentIntent: PaymentIntentDto }>(
        "/payment-intents",
        body,
        options,
      );
      return response.paymentIntent;
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
  };
}
