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
import { INVALID_REASONS } from "@mayarin/x402";
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
import { merchantX402ResourceSchema } from "../../api/src/dto/x402-resource.ts";

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
    listed: z.boolean().describe("Whether it appears in the public x402 payable index."),
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
    listed: z.boolean().describe("Whether it appears in the public x402 payable index."),
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

// The merchant x402 resource surface's wire shape (#208, #273). The register
// request is the live DTO; the response is authored here like every response.
const x402ResourceRespSchema = z
  .object({
    id: z.string(),
    merchantId: z.string(),
    url: z.string(),
    description: z.string().optional(),
    mimeType: z.string().optional(),
    price: moneySchema,
    maxTimeoutSeconds: z.number().int(),
    listed: z.boolean().describe("Whether it appears in the public x402 resource index."),
    accepts: z.array(
      z.object({
        chain: z.string(),
        asset: z.string(),
        contract: z.string(),
        payTo: z.string(),
        transferMethod: z.string(),
        domain: z.record(z.string(), z.unknown()),
      }),
    ),
  })
  .openapi("X402Resource");

// The public discovery surfaces (#273). Both indexes are cross-merchant,
// keyset-paginated and capped at 100 a page: an index with no cap is a scrape,
// and these answer for every merchant at once.
const x402DiscoveredResourceSchema = z
  .object({
    id: z.string(),
    url: z.string().describe("The URL an agent calls. A resource is looked up by it."),
    description: z.string().optional(),
    mimeType: z.string().optional(),
  })
  .openapi("X402DiscoveredResource");

const x402PayableEntrySchema = z
  .object({
    kind: z.enum(["invoice", "link"]),
    id: z.string(),
    createdAt: z.string().describe("ISO 8601."),
    merchant: z.string(),
    title: z.string().optional(),
    amount: moneySchema.describe("The price a `402` on this payable would quote."),
    url: z.string().describe("Where to send the `402` request."),
    dueAt: z.string().optional().describe("ISO 8601. Present on an invoice with a due date."),
  })
  .openapi("X402PayableEntry");

const x402RailChoiceSchema = z
  .object({
    chain: z.string().describe("The rail to pay on."),
    reason: z.string().describe("One line: why this rail, in the terms it was chosen on."),
    medianHeadroomSeconds: z
      .number()
      .optional()
      .describe("Absent when nothing about this rail was observed."),
    samples: z.number().int().describe("Settlements the choice was made over."),
    failures: z
      .number()
      .int()
      .optional()
      .describe("As recorded. Absent means nobody looked, not none."),
    unobserved: z
      .boolean()
      .describe(
        "True when no rail had enough observations and the first accepted rail was taken. Say so rather than presenting a fallback as a decision.",
      ),
  })
  .openapi("X402RailChoice");

const pageQuery = z.object({
  limit: z.coerce.number().int().optional().describe("Page size. Defaults to 50, capped at 100."),
  cursor: z.string().optional().describe("Opaque cursor from the previous page's `nextCursor`."),
});

// The payer-facing facilitator surface (#269) — what an SDK gate drives, and
// what a non-TS stack drives by hand. Authored here from the core's own types
// (`packages/core/x402/src/types.ts`), which are the specification of record.
const resourceInfoSchema = z.object({
  url: z.string(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
});

const paymentRequirementsRespSchema = z
  .object({
    scheme: z.string(),
    network: z.string().describe("CAIP-2, e.g. `eip155:84532`."),
    amount: z.string().describe("Atomic units, as a decimal string."),
    asset: z.string().describe("ERC-20 contract address."),
    payTo: z.string().describe("Recipient. The operator, not the merchant, on a cross-asset rail."),
    maxTimeoutSeconds: z.number().int(),
    extra: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Scheme data: the token's EIP-712 domain, and `assetTransferMethod` when stated."),
  })
  .openapi("X402PaymentRequirements");

const paymentRequiredRespSchema = z
  .object({
    x402Version: z.number().int(),
    error: z
      .string()
      .optional()
      .describe("Why a carried payment was refused — read it before retrying."),
    resource: resourceInfoSchema,
    accepts: z
      .array(paymentRequirementsRespSchema)
      .describe("One price, several ways to pay; the payer picks."),
    extensions: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi("X402PaymentRequired");

const verifyResponseSchema = z
  .object({
    isValid: z.boolean(),
    invalidReason: z
      .enum(INVALID_REASONS)
      .optional()
      .describe("A closed set a payer's client can branch on."),
    payer: z.string().optional(),
  })
  .openapi("X402VerifyResponse");

const settleResponseSchema = z
  .object({
    success: z.boolean(),
    errorReason: z.string().optional().describe("Free text, unlike a verify's closed set."),
    payer: z.string().optional(),
    transaction: z.string().describe("Transaction hash; the empty string when settlement failed."),
    network: z.string(),
    amount: z.string().optional(),
    extensions: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi("X402SettleResponse");

// The facilitator request body, authored inline because it lives inline in the
// route (apps/api/src/routes/x402.ts): `{x402Version, paymentPayload,
// paymentRequirements}` per the specification. The carried requirements are not
// what gets verified — Mayarin rebuilds them from the resource — they identify
// which quoted option the payer chose.
const eip3009PayloadSchema = z
  .object({
    signature: z.string(),
    authorization: z.object({
      from: z.string(),
      to: z.string(),
      value: z.string(),
      validAfter: z.string(),
      validBefore: z.string(),
      nonce: z.string().describe("32 bytes, `0x`-prefixed. Also the idempotency key server-side."),
    }),
  })
  .openapi("X402Eip3009Payload");

const paymentPayloadSchema = z
  .object({
    x402Version: z.number().int(),
    resource: resourceInfoSchema.optional(),
    accepted: paymentRequirementsRespSchema.describe("The quoted option the payer chose."),
    payload: eip3009PayloadSchema,
    extensions: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi("X402PaymentPayload");

const facilitatorBodySchema = z
  .object({
    x402Version: z.literal(2),
    paymentPayload: paymentPayloadSchema,
    paymentRequirements: paymentRequirementsRespSchema,
  })
  .strict();

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
  path: "/v1/payment-links/{id}/list",
  tags: ["Payment links"],
  operationId: "listPaymentLink",
  summary: "List a payment link in the public payable index",
  description:
    "Opts the link into the public x402 payable index, where agents discover and pay it. The link stays payable by anyone holding its URL either way; listing only decides whether a discovery reader is shown it.",
  security: secretKey,
  request: { params: idParams },
  responses: {
    "200": jsonResponse(paymentLinkSchema, "Listed payment link."),
    "404": errorResponse("No link with that id, or not this merchant's."),
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/payment-links/{id}/unlist",
  tags: ["Payment links"],
  operationId: "unlistPaymentLink",
  summary: "Remove a payment link from the public payable index",
  security: secretKey,
  request: { params: idParams },
  responses: {
    "200": jsonResponse(paymentLinkSchema, "Unlisted payment link."),
    "404": errorResponse("No link with that id, or not this merchant's."),
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
  path: "/v1/invoices/{id}/list",
  tags: ["Invoices"],
  operationId: "listInvoice",
  summary: "List an invoice in the public payable index",
  description:
    "Opts the invoice into the public x402 payable index, where agents discover and pay it. The invoice stays payable by anyone holding its id either way; listing only decides whether a discovery reader is shown it.",
  security: secretKey,
  request: { params: idParams },
  responses: {
    "200": jsonResponse(invoiceSchema, "Listed invoice."),
    "404": errorResponse("No invoice with that id, or not this merchant's."),
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/invoices/{id}/unlist",
  tags: ["Invoices"],
  operationId: "unlistInvoice",
  summary: "Remove an invoice from the public payable index",
  security: secretKey,
  request: { params: idParams },
  responses: {
    "200": jsonResponse(invoiceSchema, "Unlisted invoice."),
    "404": errorResponse("No invoice with that id, or not this merchant's."),
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

// The merchant x402 resource surface (#208). Documented from the list/unlist
// pair down: the register call is an operator act, and this reference is for
// the merchant deciding what is discoverable (#273).
registry.registerPath({
  method: "get",
  path: "/v1/x402/resources",
  tags: ["x402 resources"],
  operationId: "listX402Resources",
  summary: "List your registered resources",
  security: secretKey,
  responses: {
    "200": jsonResponse(
      z.object({ resources: z.array(x402ResourceRespSchema) }),
      "This merchant's resources.",
    ),
    "401": errorResponse("Missing or unknown API key."),
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/x402/resources",
  tags: ["x402 resources"],
  operationId: "registerX402Resource",
  summary: "Register a resource",
  description:
    "Register or re-register an endpoint this merchant hosts, so Mayarin can quote it and settle for it. The `url` must be the exact URL an agent will call — scheme, host and path all count, because a resource is identified by it. The token's EIP-712 domain and transfer method are read off the contracts at registration, never entered.",
  security: secretKey,
  request: { headers: idempotencyHeaders, body: jsonBody(merchantX402ResourceSchema) },
  responses: {
    "201": jsonResponse(z.object({ resource: x402ResourceRespSchema }), "Registered resource."),
    "400": errorResponse("Validation error, or a rail this deployment refuses."),
    "401": errorResponse("Missing or unknown API key."),
  },
});

registry.registerPath({
  method: "delete",
  path: "/v1/x402/resources/{id}",
  tags: ["x402 resources"],
  operationId: "removeX402Resource",
  summary: "Remove a resource",
  description: "Stops offering the `402`. Nothing already paid is undone.",
  security: secretKey,
  request: { params: idParams },
  responses: {
    "204": { description: "Removed." },
    "404": errorResponse("No resource with that id, or not this merchant's."),
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/x402/resources/{id}/list",
  tags: ["x402 resources"],
  operationId: "listX402Resource",
  summary: "List a resource in the public index",
  description:
    "Opts the resource into the public cross-merchant x402 index. The resource stays sellable by URL either way; listing only decides whether an agent browsing the index is shown it.",
  security: secretKey,
  request: { params: idParams },
  responses: {
    "200": jsonResponse(x402ResourceRespSchema, "Listed resource."),
    "404": errorResponse("No resource with that id, or not this merchant's."),
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/x402/resources/{id}/unlist",
  tags: ["x402 resources"],
  operationId: "unlistX402Resource",
  summary: "Remove a resource from the public index",
  security: secretKey,
  request: { params: idParams },
  responses: {
    "200": jsonResponse(x402ResourceRespSchema, "Unlisted resource."),
    "404": errorResponse("No resource with that id, or not this merchant's."),
  },
});

// The payer-facing facilitator surface (#269): public, unversioned, keyless —
// an agent that has never met Mayarin is the entire point, and a price is not
// a secret. This is what an SDK gate drives and what a non-TS stack drives by
// hand (see the guide's HTTP contract).
registry.registerPath({
  method: "get",
  path: "/x402/resources",
  tags: ["x402"],
  operationId: "discoverX402Resources",
  summary: "What is for sale, across every merchant",
  description:
    "The cross-merchant discovery index: every resource a merchant has opted into the public index, newest first. Pass `merchant` instead to read one merchant's resources — the per-merchant read is not paginated and is not limited to listed ones.\n\nNothing is listed by default. Listing only decides whether a discovery reader is shown a resource; an unlisted resource is still payable by anyone holding its URL, because the URL is the access control.",
  security: noAuth,
  request: { query: pageQuery.extend({ merchant: z.string().optional() }) },
  responses: {
    "200": jsonResponse(
      z.object({
        resources: z.array(x402DiscoveredResourceSchema),
        nextCursor: z
          .string()
          .optional()
          .describe("Present only when another page exists. Absent means the walk is done."),
      }),
      "A page of resources.",
    ),
    "400": errorResponse("Invalid `limit` or cursor."),
    "404": errorResponse("x402 is not enabled on this deployment."),
  },
});

registry.registerPath({
  method: "get",
  path: "/x402/payables",
  tags: ["x402"],
  operationId: "listX402Payables",
  summary: "Every listed obligation an agent can pay",
  description:
    "Invoices with an outstanding balance and fixed-amount payment links, across every merchant, newest first — what an agent reads before it has met anyone. Each entry carries the price a `402` would actually quote, so a reader deciding whether to pay need not ask each one.\n\nDraft, void and paid-in-full invoices, disabled and expired links, and open-amount links never appear and never quote, listed or not.",
  security: noAuth,
  request: { query: pageQuery },
  responses: {
    "200": jsonResponse(
      z.object({
        payables: z.array(x402PayableEntrySchema),
        nextCursor: z.string().optional(),
      }),
      "A page of payables.",
    ),
    "400": errorResponse("Invalid `limit` or cursor."),
    "404": errorResponse("x402 payables are not enabled on this deployment."),
  },
});

registry.registerPath({
  method: "get",
  path: "/x402/payables/{kind}/{id}",
  tags: ["x402"],
  operationId: "payX402Payable",
  summary: "Quote one invoice or link — or settle it",
  description:
    "One endpoint, two answers, decided by the `PAYMENT-SIGNATURE` header. Without one: a `402` whose `PAYMENT-REQUIRED` header quotes the **full** outstanding amount — an authorization for less than what is owed is refused, and the remedy is a new `402` for the whole balance. With one: verify, settle, and answer `200` naming the payment intent the settlement created.\n\nA payable's price is held in a quote row for a short window together with the exact rails it offered, which is what the `409` and `410` are about.",
  security: noAuth,
  request: {
    params: z.object({
      kind: z.enum(["invoice", "link"]),
      id: z.string(),
    }),
  },
  responses: {
    "200": jsonResponse(
      z.object({
        paymentIntent: z.string().describe("The intent this settlement created."),
        payable: z.object({ kind: z.enum(["invoice", "link"]), id: z.string() }),
      }),
      "Settled. `PAYMENT-RESPONSE` carries the facilitator's receipt.",
    ),
    "402": {
      description:
        "Payment required. The price and rails ride the `PAYMENT-REQUIRED` header, base64-encoded.",
    },
    "400": errorResponse("Unknown payable kind, or a signature the chain did not accept."),
    "404": errorResponse("No such payable, or it is not payable over x402."),
    "409": errorResponse(
      "Another authorization claimed this obligation first, or the amount signed is no longer the amount owed.",
    ),
    "410": errorResponse("Quote expired — request a new `402` at the same URL."),
  },
});

registry.registerPath({
  method: "get",
  path: "/x402/resources/{id}/rail",
  tags: ["x402"],
  operationId: "getX402Rail",
  summary: "Which rail to pay on, and why",
  description:
    "The ordering inside a `402` already carries the answer, but an agent reading `accepts[0]` cannot see what the order was based on. This is that reasoning in the open: median headroom, how many settlements it is over, and whether the choice was a choice at all.\n\n_Headroom_ is the seconds an order had left before its deadline when it landed. `unobserved: true` means no rail had enough observations and the first accepted rail was taken.",
  security: noAuth,
  request: { params: idParams },
  responses: {
    "200": jsonResponse(x402RailChoiceSchema, "The chosen rail and the measurements behind it."),
    "404": errorResponse("No resource with that id, or x402 is not enabled on this deployment."),
  },
});

registry.registerPath({
  method: "post",
  path: "/x402/mcp",
  tags: ["x402"],
  operationId: "callX402Mcp",
  summary: "The MCP server — free discovery, paid tools/call",
  description:
    "An MCP server over the same rail, speaking JSON-RPC 2.0. `initialize` and `tools/list` are free; `tools/call` costs one authorization and answers `402` until it carries one.\n\nDiscovery is free and answers are paid by design: an agent cannot decide a price is worth paying for a tool it has not been allowed to read the description of.\n\nTwo tools. `rail_stats` reports samples, median headroom, and the worst and best observed per rail; `choose_rail` ranks them and returns the one to pay on. Three refusals never charge — arguments the tool will not accept (refused **before** the gate, since a response cannot be un-served), no settlements observed at all, and a tool that does not exist, which is a tool error rather than a JSON-RPC error so a model can tell 'the server said no' from 'the call never arrived'.\n\nSend the **same body** in both the request that receives the `402` and the retry carrying the signature; a different one is a different purchase settled against the first one's authorization. A JSON-RPC notification (no `id`) is answered `202` with no body.",
  security: noAuth,
  request: {
    body: jsonBody(
      z.object({
        jsonrpc: z.literal("2.0"),
        id: z.union([z.string(), z.number()]).optional().describe("Omit for a notification."),
        method: z.string().describe("`initialize`, `tools/list`, or `tools/call` — the paid one."),
        params: z.record(z.string(), z.unknown()).optional(),
      }),
    ),
  },
  responses: {
    "200": jsonResponse(
      z.object({
        jsonrpc: z.literal("2.0"),
        id: z.union([z.string(), z.number()]),
        result: z.record(z.string(), z.unknown()).optional(),
        error: z
          .object({ code: z.number().int(), message: z.string() })
          .optional()
          .describe("A JSON-RPC error. A refused tool is `result.isError` instead."),
      }),
      "The JSON-RPC response.",
    ),
    "202": { description: "A notification — no id, so no response." },
    "402": {
      description: "`tools/call` with no payment. The price rides `PAYMENT-REQUIRED`.",
    },
    "404": errorResponse("x402 is not enabled on this deployment."),
  },
});

registry.registerPath({
  method: "get",
  path: "/x402/resources/{id}/payment-required",
  tags: ["x402"],
  operationId: "getX402PaymentRequired",
  summary: "Quote a resource without calling it",
  description:
    "The price and rails, without making the call being decided about. Not part of the x402 specification — the price normally rides a `402` — but a client deciding whether to pay should not have to make the call first.",
  security: noAuth,
  request: { params: idParams },
  responses: {
    "200": jsonResponse(paymentRequiredRespSchema, "The price and the rails that offer it."),
    "404": errorResponse("No resource with that id, or x402 is not enabled on this deployment."),
  },
});

registry.registerPath({
  method: "post",
  path: "/x402/resources/{id}/verify",
  tags: ["x402"],
  operationId: "verifyX402Payment",
  summary: "Would this authorization go through?",
  description:
    "Checks the signature against the chain without broadcasting. The body's `paymentRequirements` is not what gets verified — Mayarin rebuilds the requirements from the resource and uses the carried copy only to identify which quoted option the payer chose. A facilitator that verified against the requirements handed to it would verify a payment against its own claims.",
  security: noAuth,
  request: { params: idParams, body: jsonBody(facilitatorBodySchema) },
  responses: {
    "200": jsonResponse(
      verifyResponseSchema,
      "The verdict — `isValid`, and the closed-set reason when false.",
    ),
    "400": errorResponse("Validation error."),
    "404": errorResponse("No resource with that id, or x402 is not enabled on this deployment."),
  },
});

registry.registerPath({
  method: "post",
  path: "/x402/resources/{id}/settle",
  tags: ["x402"],
  operationId: "settleX402Payment",
  summary: "Broadcast it, and credit the merchant",
  description:
    "The one that moves money: verifies authoritatively, broadcasts the transfer, confirms it on-chain, and posts the double-entry records that credit the merchant. The payment's nonce is the idempotency key server-side, so a second settle of the same authorization is refused rather than charged twice. An authorization that was valid but did not settle answers `200` with `success: false` and the reason in `errorReason`.",
  security: noAuth,
  request: { params: idParams, body: jsonBody(facilitatorBodySchema) },
  responses: {
    "200": jsonResponse(settleResponseSchema, "The settlement outcome — check `success`."),
    "400": errorResponse("Validation error, or a signature the chain did not accept."),
    "404": errorResponse("No resource with that id, or x402 is not enabled on this deployment."),
    "409": errorResponse("Quote conflict — the price or rails changed under the authorization."),
    "410": errorResponse("Quote expired — request a new `402` at the same URL."),
  },
});

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
    {
      name: "x402 resources",
      description: "Per-call resources an agent pays for over the x402 rail.",
    },
    {
      name: "x402",
      description:
        "The payer-facing facilitator surface: public, unversioned, keyless. Quote, verify, settle.",
    },
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
