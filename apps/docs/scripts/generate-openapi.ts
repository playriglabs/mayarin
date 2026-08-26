/**
 * Canonical OpenAPI 3.1 generator for the public Mayarin API.
 *
 * Request bodies are single-sourced: their Zod schemas are imported from the
 * live API DTOs in `apps/api/src/dto`, so a change to a request shape lands in
 * the reference by regenerating this script. Response schemas are authored here
 * in one place — the API's response DTOs are inferred plain objects, not Zod,
 * so this file is the canonical description of response shapes. There is no
 * second hand-maintained description: `docs/api.md` points here.
 *
 * Run `bun run --cwd apps/docs generate` to write `src/lib/openapi.json`.
 * CI runs `bun run --cwd apps/docs openapi:check` and fails when the checked-in
 * artifact is stale.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from "@asteasolutions/zod-to-openapi";
import { assetCodeSchema, decimalMoneySchema } from "@mayarin/shared";
import { z } from "zod";
import {
  checkoutCartBodySchema,
  checkoutLinkBodySchema,
  createPaymentLinkBodySchema,
  createProductBodySchema,
  updateProductBodySchema,
} from "../../api/src/dto/catalog.ts";
import {
  checkoutInvoiceBodySchema,
  createInvoiceBodySchema,
  editInvoiceBodySchema,
  issueInvoiceBodySchema,
} from "../../api/src/dto/invoice.ts";
// Live API request schemas — the single source for request shapes.
import { createBodySchema } from "../../api/src/dto/payment-intent.ts";
import { refundBodySchema } from "../../api/src/dto/refund.ts";

// Adds `.openapi()` to every Zod schema so response schemas can be registered
// as named components. Must run before any `.openapi()` call.
extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

// --- Security schemes -------------------------------------------------------

registry.registerComponent("securitySchemes", "secretKey", {
  type: "http",
  scheme: "bearer",
  description: "Server-side `sk_` key. Grants a subset of the merchant's permissions.",
});
registry.registerComponent("securitySchemes", "publishableOrSecretKey", {
  type: "http",
  scheme: "bearer",
  description:
    "Browser-safe `pk_` key, or a stronger server-side `sk_` key. Identifies the merchant for catalog read and cart checkout; carries no permissions.",
});

const secretKey = [{ secretKey: [] }];
const publishableOrSecretKey = [{ publishableOrSecretKey: [] }];
const noAuth: never[] = [];

// --- Reusable request fragments ---------------------------------------------

// `params`/`query`/`headers` in zod-to-openapi are ZodObjects whose keys are
// the parameter names.
const idParams = z.object({ id: z.string() });
const intentIdParams = z.object({ intentId: z.string() });
const providerParams = z.object({ provider: z.string() });
const merchantIdQuery = z.object({ merchantId: z.string().optional() });
const checkoutQrQuery = z.object({ value: z.string().optional() });
const idempotencyHeaders = z.object({
  "Idempotency-Key": z
    .string()
    .min(1)
    .max(255)
    .describe("Stable unique key for this logical write. Keep it unchanged when retrying."),
});

const jsonBody = (schema: z.ZodType) => ({
  content: { "application/json": { schema } },
});

const jsonResponse = (schema: z.ZodType, description: string) => ({
  description,
  content: { "application/json": { schema } },
});

const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: errorSchema } },
});

// --- Response schemas (authored here — canonical response description) ------

const moneySchema = z
  .object({
    amount: z.string().describe("Exact minor units. Calculate with this value."),
    asset: z.string().describe("ISO asset code, e.g. IDR, USD, USDC."),
    formatted: z.string().describe("Machine decimal; ungrouped and dot-separated."),
    display: z.string().describe("Localized display text. Never parse this value."),
  })
  .openapi("Money");

const errorSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      retryable: z.boolean(),
      details: z.record(z.string(), z.unknown()).optional(),
    }),
  })
  .openapi("Error");

const merchantSchemaResp = z
  .object({
    id: z.string(),
    name: z.string(),
    city: z.string(),
    countryCode: z.string(),
    categoryCode: z.string().optional(),
  })
  .openapi("Merchant");

const paymentRailSchema = z
  .object({
    asset: z.string(),
    chain: z.string(),
    payerAddress: z.string().optional(),
  })
  .openapi("PaymentRail");

const paymentIntentSchema = z
  .object({
    id: z.string(),
    status: z.string().describe("Payment intent lifecycle state."),
    merchant: merchantSchemaResp,
    amount: moneySchema,
    settlementAsset: z.string(),
    provider: z.string().nullable(),
    payment: paymentRailSchema.nullable(),
    executionPath: z.string().nullable(),
    source: z.string(),
    metadata: z.record(z.string(), z.string()),
    merchantReference: z.string().nullable(),
    clearingTransactionId: z.string().nullable(),
    failureReason: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    expiresAt: z.string(),
    confirmedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
  })
  .openapi("PaymentIntent");

const rateSchema = z
  .object({
    from: z.string(),
    to: z.string(),
    scaledRate: z.string(),
    source: z.string(),
    lockedAt: z.string(),
  })
  .nullable();

const failureSchema = z.object({ reason: z.string(), code: z.string(), at: z.string() }).nullable();

const clearingSchema = z
  .object({
    id: z.string(),
    state: z.string().describe("Clearing transaction state."),
    provider: z.string(),
    providerReference: z.string().nullable(),
    transactionHash: z.string().nullable(),
    sourceAmount: moneySchema,
    settlementAmount: moneySchema.nullable(),
    fee: moneySchema.nullable(),
    netAmount: moneySchema.nullable(),
    rate: rateSchema,
    failure: failureSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Clearing");

const depositEntrySchema = z.object({
  txHash: z.string().nullable(),
  logIndex: z.number().int(),
  amount: moneySchema,
  status: z.string(),
  confirmations: z.number().int(),
  firstSeenAt: z.string(),
});

const depositSchema = z
  .object({
    address: z.string(),
    chain: z.string(),
    asset: z.string(),
    amount: moneySchema,
    uri: z
      .string()
      .nullable()
      .describe("EIP-681 payment URI for a QR, or null when none can be built safely."),
    received: moneySchema,
    required: z.number().int(),
    reviewRequired: z.boolean(),
    deposits: z.array(depositEntrySchema),
  })
  .openapi("Deposit");

const timelineEntrySchema = z.object({
  sequence: z.number().int(),
  state: z.string(),
  from: z.string().nullable(),
  occurredAt: z.string(),
});

const paymentSchema = z
  .object({
    paymentIntent: paymentIntentSchema,
    clearing: clearingSchema.nullable(),
    deposit: depositSchema.nullable(),
    timeline: z.array(timelineEntrySchema),
  })
  .openapi("Payment");

const contractCallSchema = z
  .object({
    chain: z.string(),
    chainId: z.string(),
    paymentRouter: z.string(),
    order: z.object({
      intentId: z.string(),
      settlementToken: z.string(),
      minOut: z.string(),
      fee: z.string(),
      merchantSafe: z.string(),
      refundTo: z.string(),
      deadline: z.string(),
    }),
    signature: z.string(),
    route: z
      .object({
        router: z.string(),
        callData: z.string(),
        expectedIn: z.string(),
        expiresAt: z.string().optional(),
      })
      .nullable(),
    transaction: z
      .object({ to: z.string(), data: z.string(), value: z.string() })
      .nullable()
      .describe("Ready payEth call for a native payer; null for an ERC-20 payer."),
    payerEstimate: z.string(),
    expiresAt: z.string(),
  })
  .openapi("ContractCall");

const refundSchema = z
  .object({
    id: z.string(),
    paymentIntentId: z.string(),
    amount: moneySchema,
    state: z.string(),
    reason: z.string().nullable(),
    providerReference: z.string().nullable(),
    failureReason: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Refund");

const quoteLineSchema = z.object({
  asset: z.string(),
  amount: moneySchema.nullable(),
  rate: z.object({ scaledRate: z.string().optional(), source: z.string() }).nullable(),
  available: z.boolean(),
});

const quoteSchema = z
  .object({ source: moneySchema, quotes: z.array(quoteLineSchema) })
  .openapi("Quote");

const productSchema = z
  .object({
    id: z.string(),
    merchantId: z.string(),
    sku: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    prices: z.array(moneySchema),
    active: z.boolean(),
    metadata: z.record(z.string(), z.string()),
    createdAt: z.string(),
    updatedAt: z.string(),
    version: z.number().int(),
  })
  .openapi("Product");

const paymentLinkSchema = z
  .object({
    id: z.string(),
    kind: z.string().describe("fixed, open, or catalog"),
    merchant: merchantSchemaResp,
    amount: moneySchema.nullable(),
    currency: z.string().nullable(),
    lines: z.array(z.object({ productId: z.string(), quantity: z.number().int() })).nullable(),
    title: z.string().nullable(),
    merchantReference: z.string().nullable(),
    metadata: z.record(z.string(), z.string()),
    url: z.string(),
    payable: z.boolean(),
    expiresAt: z.string().nullable(),
    disabledAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    version: z.number().int(),
  })
  .openapi("PaymentLink");

const invoiceLineSchemaResp = z.object({
  productId: z.string().nullable(),
  name: z.string(),
  unitPrice: moneySchema,
  quantity: z.number().int(),
});

const invoiceSchema = z
  .object({
    id: z.string(),
    merchantId: z.string(),
    merchant: merchantSchemaResp,
    number: z.string().nullable(),
    sequence: z.number().int().nullable(),
    state: z.string().describe("DRAFT, ISSUED, PAID, or VOID."),
    buyer: z.object({
      name: z.string(),
      email: z.string().nullable(),
      taxId: z.string().nullable(),
      address: z.string().nullable(),
    }),
    currency: z.string(),
    lines: z.array(invoiceLineSchemaResp),
    total: moneySchema,
    notes: z.string().nullable(),
    metadata: z.record(z.string(), z.string()),
    url: z.string(),
    issuedAt: z.string().nullable(),
    dueAt: z.string().nullable(),
    voidedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    version: z.number().int(),
  })
  .openapi("Invoice");

const invoiceViewSchema = invoiceSchema
  .extend({
    status: z
      .string()
      .describe("Derived payment status: DRAFT, ISSUED, PARTIALLY_PAID, PAID, or VOID."),
    paid: moneySchema,
    outstanding: moneySchema,
  })
  .openapi("InvoiceView");

// --- Request schemas --------------------------------------------------------

// The quote request body lives inline in the route, not a DTO module. Rebuild
// it from the same shared building blocks the route uses, so no live-API import
// is needed and no second description of the shared shapes is introduced.
const quoteBodySchema = z
  .object({ amount: decimalMoneySchema, assets: z.array(assetCodeSchema).min(1).max(16) })
  .strict();

// --- Paths ------------------------------------------------------------------

registry.registerPath({
  method: "post",
  path: "/v1/payment-intents",
  tags: ["Payment intents"],
  operationId: "createPaymentIntent",
  summary: "Create a payment intent",
  description:
    "Creates an immutable fiat-denominated payment request. Reusing an idempotency key with the same body returns the original intent; the same key with different parameters is a 409.",
  security: secretKey,
  request: { headers: idempotencyHeaders, body: jsonBody(createBodySchema) },
  responses: {
    "201": jsonResponse(paymentIntentSchema, "Payment intent created."),
    "400": errorResponse("Validation error."),
    "401": errorResponse("Missing or unknown API key."),
    "409": errorResponse("Idempotency conflict or state conflict."),
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/payment-intents/{id}",
  tags: ["Payment intents"],
  operationId: "getPaymentIntent",
  summary: "Get a payment intent",
  security: noAuth,
  request: { params: idParams },
  responses: {
    "200": jsonResponse(paymentIntentSchema, "Current intent."),
    "404": errorResponse("No intent with that id."),
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/payment-intents/{id}/confirm",
  tags: ["Payment intents"],
  operationId: "confirmPaymentIntent",
  summary: "Confirm a payment intent",
  description:
    "Confirms the intent and hands it to the clearing engine. Safe to retry: confirming an intent that is already clearing returns its current position rather than starting a second one.",
  security: noAuth,
  request: { params: idParams, headers: idempotencyHeaders },
  responses: {
    "200": jsonResponse(paymentSchema, "Current payment and clearing state."),
    "404": errorResponse("No intent with that id."),
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/payments/{id}",
  tags: ["Payments"],
  operationId: "getPayment",
  summary: "Get payment status",
  description: "Accepts a payment intent id (`pi_…`) or clearing transaction id (`clr_…`).",
  security: noAuth,
  request: { params: idParams },
  responses: {
    "200": jsonResponse(paymentSchema, "Payment, clearing state, deposit, and timeline."),
    "404": errorResponse("No payment with that id."),
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/payments/{id}/contract-call",
  tags: ["Payments"],
  operationId: "getPaymentContractCall",
  summary: "Get fresh contract call data",
  description:
    "Returns the signed EIP-712 order, the deployed PaymentRouter address and chain, and a fresh executable route for an on-chain-contract payment. A 404 means the contract path is not enabled; a 410 means the quote lock expired — request a new payment.",
  security: noAuth,
  request: { params: idParams },
  responses: {
    "200": jsonResponse(contractCallSchema, "Signed order and submit payload."),
    "404": errorResponse("Contract path not enabled, or no such payment."),
    "410": errorResponse("Quote lock expired."),
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/payments/{id}/refunds",
  tags: ["Payments"],
  operationId: "listPaymentRefunds",
  summary: "List refunds for a payment",
  security: noAuth,
  request: { params: idParams },
  responses: {
    "200": jsonResponse(z.array(refundSchema), "Refund records."),
    "404": errorResponse("No payment with that id."),
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/payments/{id}/refunds",
  tags: ["Payments"],
  operationId: "createPaymentRefund",
  summary: "Create a refund",
  security: secretKey,
  request: { params: idParams, headers: idempotencyHeaders, body: jsonBody(refundBodySchema) },
  responses: {
    "201": jsonResponse(refundSchema, "Refund created."),
    "400": errorResponse("Validation error or non-refundable state."),
    "404": errorResponse("No payment with that id."),
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/quotes",
  tags: ["Quotes"],
  operationId: "createQuote",
  summary: "Preview payer-asset quotes",
  description:
    "Indicative preview of what a payment would cost in each payer asset. An asset the rate provider cannot price is returned as an unavailable line rather than failing the request.",
  security: noAuth,
  request: { headers: idempotencyHeaders, body: jsonBody(quoteBodySchema) },
  responses: {
    "200": jsonResponse(quoteSchema, "Guarded quote preview."),
    "400": errorResponse("Validation error."),
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/catalog/products",
  tags: ["Catalog"],
  operationId: "listProducts",
  summary: "List catalog products",
  security: publishableOrSecretKey,
  request: { query: merchantIdQuery },
  responses: {
    "200": jsonResponse(z.array(productSchema), "Merchant products."),
    "401": errorResponse("Missing or unknown API key."),
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/catalog/products",
  tags: ["Catalog"],
  operationId: "createProduct",
  summary: "Create a product",
  security: secretKey,
  request: { headers: idempotencyHeaders, body: jsonBody(createProductBodySchema) },
  responses: {
    "201": jsonResponse(productSchema, "Product created."),
    "400": errorResponse("Validation error."),
    "401": errorResponse("Missing or unknown API key."),
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/catalog/products/{id}",
  tags: ["Catalog"],
  operationId: "getProduct",
  summary: "Get a product",
  security: noAuth,
  request: { params: idParams },
  responses: {
    "200": jsonResponse(productSchema, "Product."),
    "404": errorResponse("No product with that id."),
  },
});

registry.registerPath({
  method: "patch",
  path: "/v1/catalog/products/{id}",
  tags: ["Catalog"],
  operationId: "updateProduct",
  summary: "Update a product",
  security: secretKey,
  request: {
    params: idParams,
    headers: idempotencyHeaders,
    body: jsonBody(updateProductBodySchema),
  },
  responses: {
    "200": jsonResponse(productSchema, "Updated product."),
    "404": errorResponse("No product with that id."),
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/carts/checkout",
  tags: ["Catalog"],
  operationId: "checkoutCart",
  summary: "Check out a cart",
  security: publishableOrSecretKey,
  request: { headers: idempotencyHeaders, body: jsonBody(checkoutCartBodySchema) },
  responses: {
    "201": jsonResponse(paymentIntentSchema, "Payment intent created from the cart."),
    "400": errorResponse("Validation error."),
    "401": errorResponse("Missing or unknown API key."),
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/payment-links",
  tags: ["Payment links"],
  operationId: "listPaymentLinks",
  summary: "List payment links",
  security: secretKey,
  request: { query: merchantIdQuery },
  responses: {
    "200": jsonResponse(z.array(paymentLinkSchema), "Payment links."),
    "401": errorResponse("Missing or unknown API key."),
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/payment-links",
  tags: ["Payment links"],
  operationId: "createPaymentLink",
  summary: "Create a payment link",
  security: secretKey,
  request: { headers: idempotencyHeaders, body: jsonBody(createPaymentLinkBodySchema) },
  responses: {
    "201": jsonResponse(paymentLinkSchema, "Payment link created."),
    "400": errorResponse("Validation error."),
    "401": errorResponse("Missing or unknown API key."),
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/payment-links/{id}",
  tags: ["Payment links"],
  operationId: "getPaymentLink",
  summary: "Get a payment link",
  security: noAuth,
  request: { params: idParams },
  responses: {
    "200": jsonResponse(paymentLinkSchema, "Payment link."),
    "404": errorResponse("No link with that id."),
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/payment-links/{id}/disable",
  tags: ["Payment links"],
  operationId: "disablePaymentLink",
  summary: "Disable a payment link",
  security: secretKey,
  request: { params: idParams, headers: idempotencyHeaders },
  responses: {
    "200": jsonResponse(paymentLinkSchema, "Disabled payment link."),
    "404": errorResponse("No link with that id."),
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/payment-links/{id}/checkout",
  tags: ["Payment links"],
  operationId: "checkoutPaymentLink",
  summary: "Check out a payment link",
  security: noAuth,
  request: {
    params: idParams,
    headers: idempotencyHeaders,
    body: jsonBody(checkoutLinkBodySchema),
  },
  responses: {
    "201": jsonResponse(paymentIntentSchema, "Payment intent created."),
    "404": errorResponse("No link with that id."),
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/invoices",
  tags: ["Invoices"],
  operationId: "listInvoices",
  summary: "List invoices",
  security: secretKey,
  request: { query: merchantIdQuery },
  responses: {
    "200": jsonResponse(z.array(invoiceSchema), "Invoices."),
    "401": errorResponse("Missing or unknown API key."),
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/invoices",
  tags: ["Invoices"],
  operationId: "createInvoice",
  summary: "Create a draft invoice",
  security: secretKey,
  request: { headers: idempotencyHeaders, body: jsonBody(createInvoiceBodySchema) },
  responses: {
    "201": jsonResponse(invoiceSchema, "Draft invoice created."),
    "400": errorResponse("Validation error."),
    "401": errorResponse("Missing or unknown API key."),
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/invoices/{id}",
  tags: ["Invoices"],
  operationId: "getInvoice",
  summary: "Get an invoice",
  security: noAuth,
  request: { params: idParams },
  responses: {
    "200": jsonResponse(invoiceViewSchema, "Invoice with derived paid/outstanding figures."),
    "404": errorResponse("No invoice with that id."),
  },
});

registry.registerPath({
  method: "patch",
  path: "/v1/invoices/{id}",
  tags: ["Invoices"],
  operationId: "updateInvoice",
  summary: "Update a draft invoice",
  security: secretKey,
  request: { params: idParams, headers: idempotencyHeaders, body: jsonBody(editInvoiceBodySchema) },
  responses: {
    "200": jsonResponse(invoiceSchema, "Updated invoice."),
    "404": errorResponse("No invoice with that id."),
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/invoices/{id}/issue",
  tags: ["Invoices"],
  operationId: "issueInvoice",
  summary: "Issue an invoice",
  security: secretKey,
  request: {
    params: idParams,
    headers: idempotencyHeaders,
    body: jsonBody(issueInvoiceBodySchema),
  },
  responses: {
    "200": jsonResponse(invoiceSchema, "Issued invoice."),
    "404": errorResponse("No invoice with that id."),
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/invoices/{id}/void",
  tags: ["Invoices"],
  operationId: "voidInvoice",
  summary: "Void an invoice",
  security: secretKey,
  request: { params: idParams, headers: idempotencyHeaders },
  responses: {
    "200": jsonResponse(invoiceSchema, "Voided invoice."),
    "404": errorResponse("No invoice with that id."),
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/invoices/{id}/checkout",
  tags: ["Invoices"],
  operationId: "checkoutInvoice",
  summary: "Check out an issued invoice",
  security: noAuth,
  request: {
    params: idParams,
    headers: idempotencyHeaders,
    body: jsonBody(checkoutInvoiceBodySchema),
  },
  responses: {
    "201": jsonResponse(paymentIntentSchema, "Payment intent created."),
    "404": errorResponse("No invoice with that id."),
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/webhooks/{provider}",
  tags: ["Webhooks"],
  operationId: "receiveProviderWebhook",
  summary: "Receive a provider webhook",
  description:
    "Provider callback surface. Integrators normally configure outbound merchant webhooks in the dashboard instead of calling this operation. The raw body is passed to the adapter so signatures verify over exactly the signed bytes.",
  security: noAuth,
  request: {
    params: providerParams,
    body: jsonBody(z.record(z.string(), z.unknown())),
  },
  responses: {
    "200": {
      description: "Signal accepted.",
      content: { "application/json": { schema: z.object({ ok: z.boolean() }) } },
    },
  },
});

// --- Unversioned public routes (root, never moved by a version bump) -------

registry.registerPath({
  method: "get",
  path: "/health",
  tags: ["Unversioned"],
  operationId: "getHealth",
  summary: "Deployment health probe",
  description: "Intentionally unversioned. Stays at the root forever.",
  security: noAuth,
  responses: {
    "200": {
      description: "Healthy.",
      content: { "application/json": { schema: z.object({ status: z.string() }) } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/checkout/{id}",
  tags: ["Unversioned"],
  operationId: "getCheckoutPage",
  summary: "Hosted checkout page",
  description:
    "Intentionally unversioned. Renders the hosted checkout for a payment link. A printed QR and a shared link encode this URL, so a version bump must never move it.",
  security: noAuth,
  request: { params: idParams },
  responses: {
    "200": {
      description: "Checkout HTML page.",
      content: { "text/html": { schema: { type: "string" } } },
    },
    "404": errorResponse("No link with that id."),
  },
});

registry.registerPath({
  method: "get",
  path: "/checkout/pay/{intentId}",
  tags: ["Unversioned"],
  operationId: "getCheckoutPayPage",
  summary: "Hosted pay page for one intent",
  description: "Intentionally unversioned. Renders the pay flow for a single payment intent.",
  security: noAuth,
  request: { params: intentIdParams },
  responses: {
    "200": {
      description: "Pay HTML page.",
      content: { "text/html": { schema: { type: "string" } } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/checkout/qr",
  tags: ["Unversioned"],
  operationId: "getCheckoutQr",
  summary: "Render a QR as SVG",
  description: "Intentionally unversioned. Renders an SVG QR for a `value` query string.",
  security: noAuth,
  request: { query: checkoutQrQuery },
  responses: {
    "200": {
      description: "QR SVG image.",
      content: { "image/svg+xml": { schema: { type: "string" } } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/checkout/events/{intentId}",
  tags: ["Unversioned"],
  operationId: "getCheckoutEvents",
  summary: "Live payment status stream",
  description:
    "Intentionally unversioned. Server-Sent Events: the first frame carries the current status; later frames are a nudge (`event: payment`) that tells the client to re-read the payment. The stream closes once the payment is terminal.",
  security: noAuth,
  request: { params: intentIdParams },
  responses: {
    "200": {
      description: "SSE stream of payment status nudges.",
      content: { "text/event-stream": { schema: { type: "string" } } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/invoices/{id}/view",
  tags: ["Unversioned"],
  operationId: "getInvoiceViewPage",
  summary: "Hosted invoice page",
  description: "Intentionally unversioned. Renders the hosted invoice a buyer sees.",
  security: noAuth,
  request: { params: idParams },
  responses: {
    "200": {
      description: "Invoice HTML page.",
      content: { "text/html": { schema: { type: "string" } } },
    },
    "404": errorResponse("No invoice with that id."),
  },
});

// --- Generate ---------------------------------------------------------------

const generator = new OpenApiGeneratorV31(registry.definitions);

const document = generator.generateDocument({
  openapi: "3.1.0",
  info: {
    title: "Mayarin API",
    version: "2026-08-11",
    description:
      "Create fiat-denominated commerce requests, accept supported crypto assets, and settle merchants in stablecoins. Versioned operations live under `/v1`; buyer-facing checkout, invoice, and health routes are intentionally unversioned.",
  },
  servers: [
    { url: "https://api.mayarin.xyz", description: "Mainnet" },
    { url: "https://api-testnet.mayarin.xyz", description: "Testnet" },
    { url: "http://localhost:3000", description: "Local development" },
  ],
  tags: [
    { name: "Payment intents", description: "Immutable requests for payment." },
    { name: "Payments", description: "Clearing status, execution, and refunds." },
    { name: "Quotes", description: "Payer-asset previews and guarded pricing." },
    { name: "Catalog", description: "Merchant products and cart checkout." },
    { name: "Payment links", description: "Shareable hosted checkout links." },
    { name: "Invoices", description: "Numbered requests with buyers and due dates." },
    { name: "Webhooks", description: "Provider signals into Mayarin." },
    {
      name: "Unversioned",
      description:
        "Buyer-facing routes that stay at the root forever. A printed QR and a shared link encode them, so a version bump must never move them.",
    },
  ],
});

const outPath = resolve(import.meta.dirname, "../src/lib/openapi.json");
writeFileSync(outPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
process.stdout.write(`wrote ${outPath}\n`);
