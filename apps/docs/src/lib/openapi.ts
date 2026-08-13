import type { OpenAPIV3_1 } from "fumadocs-openapi";
import { createOpenAPI, type OpenAPIOptions } from "fumadocs-openapi/server";

const json = { "application/json": { schema: { type: "object" } } } as const;
const idParameter = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string" },
} as const;

export const mayarinOpenAPI = {
  openapi: "3.1.0",
  info: {
    title: "Mayarin API",
    version: "2026-08-11",
    description:
      "Create fiat-denominated commerce requests, accept supported crypto assets, and settle merchants in stablecoins.",
  },
  servers: [
    { url: "https://api.mayarin.xyz/v1", description: "Production" },
    { url: "http://localhost:3000/v1", description: "Local development" },
  ],
  tags: [
    { name: "Payment intents", description: "Immutable requests for payment." },
    { name: "Payments", description: "Clearing status, execution, and refunds." },
    { name: "Quotes", description: "Payer-asset previews and guarded pricing." },
    { name: "Catalog", description: "Merchant products and cart checkout." },
    { name: "Payment links", description: "Shareable hosted checkout links." },
    { name: "Invoices", description: "Numbered requests with buyers and due dates." },
    { name: "Webhooks", description: "Provider signals into Mayarin." },
  ],
  paths: {
    "/payment-intents": {
      post: {
        operationId: "createPaymentIntent",
        tags: ["Payment intents"],
        summary: "Create a payment intent",
        description:
          "Creates an immutable fiat-denominated payment request. Reusing an idempotency key with the same body returns the original intent.",
        security: [{ secretKey: [] }],
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/CreatePaymentIntent" } },
          },
        },
        responses: {
          "201": { description: "Payment intent created", content: json },
          "400": { $ref: "#/components/responses/Error" },
          "401": { $ref: "#/components/responses/Error" },
          "409": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/payment-intents/{id}": {
      get: {
        operationId: "getPaymentIntent",
        tags: ["Payment intents"],
        summary: "Get a payment intent",
        security: [],
        parameters: [idParameter],
        responses: {
          "200": { description: "Current intent", content: json },
          "404": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/payment-intents/{id}/confirm": {
      post: {
        operationId: "confirmPaymentIntent",
        tags: ["Payment intents"],
        summary: "Confirm a payment intent",
        description: "Confirms an intent and advances it into clearing. Safe to retry.",
        security: [],
        parameters: [idParameter, { $ref: "#/components/parameters/IdempotencyKey" }],
        responses: {
          "200": { description: "Current payment and clearing state", content: json },
          "404": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/payments/{id}": {
      get: {
        operationId: "getPayment",
        tags: ["Payments"],
        summary: "Get payment status",
        description: "Accepts a payment intent ID (`pi_…`) or clearing transaction ID (`clr_…`).",
        security: [],
        parameters: [idParameter],
        responses: {
          "200": {
            description: "Payment, clearing state, timeline, and execution details",
            content: json,
          },
          "404": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/payments/{id}/contract-call": {
      get: {
        operationId: "getPaymentContractCall",
        tags: ["Payments"],
        summary: "Get fresh contract call data",
        description:
          "Returns the signed order, router identity, and a fresh executable route for an on-chain-contract payment.",
        security: [],
        parameters: [idParameter],
        responses: {
          "200": { description: "Signed order and submit payload", content: json },
          "404": { $ref: "#/components/responses/Error" },
          "410": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/payments/{id}/refunds": {
      get: {
        operationId: "listPaymentRefunds",
        tags: ["Payments"],
        summary: "List refunds for a payment",
        security: [],
        parameters: [idParameter],
        responses: { "200": { description: "Refund records", content: json } },
      },
      post: {
        operationId: "createPaymentRefund",
        tags: ["Payments"],
        summary: "Create a refund",
        security: [{ secretKey: [] }],
        parameters: [idParameter, { $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: { required: true, content: json },
        responses: {
          "201": { description: "Refund created", content: json },
          "400": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/quotes": {
      post: {
        operationId: "createQuote",
        tags: ["Quotes"],
        summary: "Preview a payer-asset quote",
        security: [],
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: { required: true, content: json },
        responses: {
          "200": { description: "Guarded quote preview", content: json },
          "400": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/catalog/products": {
      get: {
        operationId: "listProducts",
        tags: ["Catalog"],
        summary: "List catalog products",
        security: [{ publishableOrSecretKey: [] }],
        parameters: [{ name: "merchantId", in: "query", schema: { type: "string" } }],
        responses: { "200": { description: "Merchant products", content: json } },
      },
      post: {
        operationId: "createProduct",
        tags: ["Catalog"],
        summary: "Create a product",
        security: [{ secretKey: [] }],
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: { required: true, content: json },
        responses: { "201": { description: "Product created", content: json } },
      },
    },
    "/catalog/products/{id}": {
      get: {
        operationId: "getProduct",
        tags: ["Catalog"],
        summary: "Get a product",
        security: [],
        parameters: [idParameter],
        responses: { "200": { description: "Product", content: json } },
      },
      patch: {
        operationId: "updateProduct",
        tags: ["Catalog"],
        summary: "Update a product",
        security: [{ secretKey: [] }],
        parameters: [idParameter, { $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: { required: true, content: json },
        responses: { "200": { description: "Updated product", content: json } },
      },
    },
    "/carts/checkout": {
      post: {
        operationId: "checkoutCart",
        tags: ["Catalog"],
        summary: "Check out a cart",
        security: [{ publishableOrSecretKey: [] }],
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: { required: true, content: json },
        responses: {
          "201": { description: "Payment intent created from the cart", content: json },
        },
      },
    },
    "/payment-links": {
      get: {
        operationId: "listPaymentLinks",
        tags: ["Payment links"],
        summary: "List payment links",
        security: [{ secretKey: [] }],
        parameters: [{ name: "merchantId", in: "query", schema: { type: "string" } }],
        responses: { "200": { description: "Payment links", content: json } },
      },
      post: {
        operationId: "createPaymentLink",
        tags: ["Payment links"],
        summary: "Create a payment link",
        security: [{ secretKey: [] }],
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: { required: true, content: json },
        responses: { "201": { description: "Payment link created", content: json } },
      },
    },
    "/payment-links/{id}": {
      get: {
        operationId: "getPaymentLink",
        tags: ["Payment links"],
        summary: "Get a payment link",
        security: [],
        parameters: [idParameter],
        responses: { "200": { description: "Payment link", content: json } },
      },
    },
    "/payment-links/{id}/disable": {
      post: {
        operationId: "disablePaymentLink",
        tags: ["Payment links"],
        summary: "Disable a payment link",
        security: [{ secretKey: [] }],
        parameters: [idParameter, { $ref: "#/components/parameters/IdempotencyKey" }],
        responses: { "200": { description: "Disabled payment link", content: json } },
      },
    },
    "/payment-links/{id}/checkout": {
      post: {
        operationId: "checkoutPaymentLink",
        tags: ["Payment links"],
        summary: "Check out a payment link",
        security: [],
        parameters: [idParameter, { $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: { content: json },
        responses: { "201": { description: "Payment intent created", content: json } },
      },
    },
    "/invoices": {
      get: {
        operationId: "listInvoices",
        tags: ["Invoices"],
        summary: "List invoices",
        security: [{ secretKey: [] }],
        parameters: [{ name: "merchantId", in: "query", schema: { type: "string" } }],
        responses: { "200": { description: "Invoices", content: json } },
      },
      post: {
        operationId: "createInvoice",
        tags: ["Invoices"],
        summary: "Create a draft invoice",
        security: [{ secretKey: [] }],
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: { required: true, content: json },
        responses: { "201": { description: "Draft invoice created", content: json } },
      },
    },
    "/invoices/{id}": {
      get: {
        operationId: "getInvoice",
        tags: ["Invoices"],
        summary: "Get an invoice",
        security: [],
        parameters: [idParameter],
        responses: { "200": { description: "Invoice", content: json } },
      },
      patch: {
        operationId: "updateInvoice",
        tags: ["Invoices"],
        summary: "Update a draft invoice",
        security: [{ secretKey: [] }],
        parameters: [idParameter, { $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: { required: true, content: json },
        responses: { "200": { description: "Updated invoice", content: json } },
      },
    },
    "/invoices/{id}/issue": {
      post: {
        operationId: "issueInvoice",
        tags: ["Invoices"],
        summary: "Issue an invoice",
        security: [{ secretKey: [] }],
        parameters: [idParameter, { $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: { content: json },
        responses: { "200": { description: "Issued invoice", content: json } },
      },
    },
    "/invoices/{id}/void": {
      post: {
        operationId: "voidInvoice",
        tags: ["Invoices"],
        summary: "Void an invoice",
        security: [{ secretKey: [] }],
        parameters: [idParameter, { $ref: "#/components/parameters/IdempotencyKey" }],
        responses: { "200": { description: "Voided invoice", content: json } },
      },
    },
    "/invoices/{id}/checkout": {
      post: {
        operationId: "checkoutInvoice",
        tags: ["Invoices"],
        summary: "Check out an issued invoice",
        security: [],
        parameters: [idParameter, { $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: { content: json },
        responses: { "201": { description: "Payment intent created", content: json } },
      },
    },
    "/webhooks/{provider}": {
      post: {
        operationId: "receiveProviderWebhook",
        tags: ["Webhooks"],
        summary: "Receive a provider webhook",
        description:
          "Provider callback surface. Integrators normally configure Mayarin merchant webhooks in the dashboard instead of calling this operation.",
        security: [],
        parameters: [{ name: "provider", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: json },
        responses: { "200": { description: "Signal accepted", content: json } },
      },
    },
  },
  components: {
    securitySchemes: {
      secretKey: { type: "http", scheme: "bearer", description: "Server-side `sk_` key." },
      publishableOrSecretKey: {
        type: "http",
        scheme: "bearer",
        description: "Browser-safe `pk_` key or a stronger server-side `sk_` key.",
      },
    },
    parameters: {
      IdempotencyKey: {
        name: "Idempotency-Key",
        in: "header",
        required: true,
        description: "Stable unique key for this logical write. Keep it unchanged when retrying.",
        schema: { type: "string", minLength: 1, maxLength: 255 },
      },
    },
    responses: {
      Error: {
        description: "Mayarin error",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
    },
    schemas: {
      Money: {
        type: "object",
        required: ["amount", "asset", "formatted", "display"],
        properties: {
          amount: { type: "string", description: "Exact minor units. Calculate with this value." },
          asset: { type: "string", examples: ["IDR", "IDRX", "USDC"] },
          formatted: {
            type: "string",
            description: "Machine decimal; ungrouped and dot-separated.",
          },
          display: {
            type: "string",
            description: "Localized display text. Never parse this value.",
          },
        },
      },
      Merchant: {
        type: "object",
        required: ["id", "name", "city", "countryCode"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          city: { type: "string" },
          countryCode: { type: "string", pattern: "^[A-Z]{2}$" },
        },
      },
      CreatePaymentIntent: {
        type: "object",
        required: ["merchant", "amount"],
        properties: {
          merchant: { $ref: "#/components/schemas/Merchant" },
          amount: {
            type: "object",
            required: ["amount", "asset"],
            properties: {
              amount: { type: "string", examples: ["50000.00"] },
              asset: { type: "string", examples: ["IDR"] },
            },
          },
          settlementAsset: { type: "string", examples: ["IDRX", "USDC"] },
          executionPath: { type: "string", enum: ["on-chain-contract", "deposit-match"] },
        },
      },
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message", "retryable"],
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              retryable: { type: "boolean" },
              details: { type: "object", additionalProperties: true },
            },
          },
        },
      },
    },
  },
} satisfies OpenAPIV3_1.Document;

const openapiInput = { mayarin: mayarinOpenAPI } as unknown as Exclude<
  NonNullable<OpenAPIOptions["input"]>,
  string[]
>;

export const openapi = createOpenAPI({ input: openapiInput });
