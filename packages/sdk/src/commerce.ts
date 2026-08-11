import type {
  CheckoutInvoiceBody,
  CheckoutPaymentLinkBody,
  CreateInvoiceBody,
  CreatePaymentLinkBody,
  CreateProductBody,
  EditInvoiceBodyDto,
  InvoiceDto,
  InvoiceViewDto,
  IssueInvoiceBodyDto,
  PaymentIntentDto,
  PaymentLinkDto,
  ProductDto,
  UpdateProductBody,
} from "@mayarin/api/dto";
import type { RequestOptions, Transport } from "./transport.ts";

export interface CommerceModule {
  readonly products: {
    readonly create: (body: CreateProductBody, options?: RequestOptions) => Promise<ProductDto>;
    readonly list: (
      merchantId?: string,
      options?: RequestOptions,
    ) => Promise<readonly ProductDto[]>;
    readonly get: (id: string, options?: RequestOptions) => Promise<ProductDto>;
    readonly update: (
      id: string,
      body: UpdateProductBody,
      options?: RequestOptions,
    ) => Promise<ProductDto>;
  };
  readonly paymentLinks: {
    readonly create: (
      body: CreatePaymentLinkBody,
      options?: RequestOptions,
    ) => Promise<PaymentLinkDto>;
    readonly list: (
      merchantId?: string,
      options?: RequestOptions,
    ) => Promise<readonly PaymentLinkDto[]>;
    readonly get: (id: string, options?: RequestOptions) => Promise<PaymentLinkDto>;
    readonly disable: (id: string, options?: RequestOptions) => Promise<PaymentLinkDto>;
    readonly checkout: (
      id: string,
      body?: CheckoutPaymentLinkBody,
      options?: RequestOptions,
    ) => Promise<PaymentIntentDto>;
  };
  readonly invoices: {
    readonly create: (body: CreateInvoiceBody, options?: RequestOptions) => Promise<InvoiceDto>;
    readonly list: (
      merchantId?: string,
      options?: RequestOptions,
    ) => Promise<readonly InvoiceDto[]>;
    readonly get: (id: string, options?: RequestOptions) => Promise<InvoiceViewDto>;
    readonly update: (
      id: string,
      body: EditInvoiceBodyDto,
      options?: RequestOptions,
    ) => Promise<InvoiceDto>;
    readonly issue: (
      id: string,
      body: IssueInvoiceBodyDto,
      options?: RequestOptions,
    ) => Promise<InvoiceDto>;
    readonly void: (id: string, options?: RequestOptions) => Promise<InvoiceDto>;
    readonly checkout: (
      id: string,
      body?: CheckoutInvoiceBody,
      options?: RequestOptions,
    ) => Promise<PaymentIntentDto>;
  };
}

function itemPath(base: string, id: string): string {
  return `${base}/${encodeURIComponent(id)}`;
}

function merchantQuery(
  merchantId: string | undefined,
  options: RequestOptions | undefined,
): RequestOptions | undefined {
  return merchantId === undefined
    ? options
    : { ...options, query: { ...options?.query, merchantId } };
}

export function createCommerceModule(transport: Transport): CommerceModule {
  return {
    products: {
      create: async (body, options) =>
        (await transport.post<{ product: ProductDto }>("/catalog/products", body, options)).product,
      list: async (merchantId, options) =>
        (
          await transport.get<{ products: readonly ProductDto[] }>(
            "/catalog/products",
            merchantQuery(merchantId, options),
          )
        ).products,
      get: async (id, options) =>
        (await transport.get<{ product: ProductDto }>(itemPath("/catalog/products", id), options))
          .product,
      update: async (id, body, options) =>
        (
          await transport.patch<{ product: ProductDto }>(
            itemPath("/catalog/products", id),
            body,
            options,
          )
        ).product,
    },
    paymentLinks: {
      create: async (body, options) =>
        (await transport.post<{ paymentLink: PaymentLinkDto }>("/payment-links", body, options))
          .paymentLink,
      list: async (merchantId, options) =>
        (
          await transport.get<{ paymentLinks: readonly PaymentLinkDto[] }>(
            "/payment-links",
            merchantQuery(merchantId, options),
          )
        ).paymentLinks,
      get: async (id, options) =>
        (
          await transport.get<{ paymentLink: PaymentLinkDto }>(
            itemPath("/payment-links", id),
            options,
          )
        ).paymentLink,
      disable: async (id, options) =>
        (
          await transport.post<{ paymentLink: PaymentLinkDto }>(
            `${itemPath("/payment-links", id)}/disable`,
            undefined,
            options,
          )
        ).paymentLink,
      checkout: async (id, body = {}, options) =>
        (
          await transport.post<{ paymentIntent: PaymentIntentDto }>(
            `${itemPath("/payment-links", id)}/checkout`,
            body,
            options,
          )
        ).paymentIntent,
    },
    invoices: {
      create: async (body, options) =>
        (await transport.post<{ invoice: InvoiceDto }>("/invoices", body, options)).invoice,
      list: async (merchantId, options) =>
        (
          await transport.get<{ invoices: readonly InvoiceDto[] }>(
            "/invoices",
            merchantQuery(merchantId, options),
          )
        ).invoices,
      get: async (id, options) =>
        (await transport.get<{ invoice: InvoiceViewDto }>(itemPath("/invoices", id), options))
          .invoice,
      update: async (id, body, options) =>
        (await transport.patch<{ invoice: InvoiceDto }>(itemPath("/invoices", id), body, options))
          .invoice,
      issue: async (id, body, options) =>
        (
          await transport.post<{ invoice: InvoiceDto }>(
            `${itemPath("/invoices", id)}/issue`,
            body,
            options,
          )
        ).invoice,
      void: async (id, options) =>
        (
          await transport.post<{ invoice: InvoiceDto }>(
            `${itemPath("/invoices", id)}/void`,
            undefined,
            options,
          )
        ).invoice,
      checkout: async (id, body = {}, options) =>
        (
          await transport.post<{ paymentIntent: PaymentIntentDto }>(
            `${itemPath("/invoices", id)}/checkout`,
            body,
            options,
          )
        ).paymentIntent,
    },
  };
}
