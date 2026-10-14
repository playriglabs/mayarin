/**
 * TransFi fiat on-ramp client.
 *
 * A payer pays in a local rail (GCash, QRIS, FPX, ...) and TransFi delivers the
 * stablecoin to a wallet address we name per order — the intent's deposit
 * address. The chain watcher does the rest, so nothing here settles a payment.
 *
 * The API is float-denominated: amounts are JSON numbers. They are confined to
 * this package and never reach a `Money`; what the payer actually delivers is
 * read back from the chain, not from this client.
 *
 * `fetch` is injected, as `Clock` is: tests pass a fake and nothing here
 * touches the network on its own.
 */

import { ConfigurationError, ProviderError } from "@mayarin/shared";
import { z } from "zod";
import { instructionsOf, type PaymentInstructions } from "./instructions.ts";

export interface TransfiConfig {
  readonly baseUrl: string;
  readonly mid: string;
  readonly username: string;
  readonly password: string;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface PaymentMethod {
  readonly code: string;
  readonly type: string;
  readonly name: string;
  readonly minAmount: number;
  readonly maxAmount: number;
  /** TransFi's own mark for the method, as an SVG on its CDN. */
  readonly logoUrl: string | null;
  /**
   * The payer details this method wants alongside the order (`firstName`,
   * `email`, `phone`, ...). They differ per method — QR Ph takes a name, GCash
   * adds a phone — so the order is built from this list, not from a fixed shape.
   */
  readonly fields: readonly string[];
}

export interface RateQuote {
  readonly sourceAmount: number;
  readonly destinationAmount: number;
  readonly minLimit: number;
  readonly maxLimit: number;
  readonly totalFee: number;
}

/**
 * What TransFi needs to know about the payer before it will take an order.
 *
 * Passed through to TransFi and not kept: nothing in Mayarin stores or logs it.
 */
export interface PayerDetails {
  readonly firstName: string;
  readonly lastName: string;
  readonly country: string;
  /** DD-MM-YYYY, as TransFi's API expects. */
  readonly dateOfBirth: string;
  readonly email: string;
  readonly phone: string;
  readonly phoneCode: string;
  /**
   * TransFi requires an address object but no particular field in it; an empty
   * one is refused, so `city` is the one we always send.
   */
  readonly address: {
    readonly city: string;
    readonly street?: string | undefined;
    readonly state?: string | undefined;
    readonly postalCode?: string | undefined;
  };
}

export interface OnrampOrderRequest {
  readonly userId: string;
  /** Our own id for this order — the payment intent id. */
  readonly partnerId: string;
  readonly fiatCurrency: string;
  readonly fiatAmount: number;
  readonly paymentCode: string;
  readonly paymentType: string;
  /** TransFi's token code, network included: `USDCARB`, `USDCBASE`. */
  readonly cryptoCurrency: string;
  readonly walletAddress: string;
  readonly successRedirectUrl: string;
  readonly failureRedirectUrl: string;
  /** Values for the method's `fields`, keyed by field name. */
  readonly details: Readonly<Record<string, string>>;
  /** The payer's browser and address; some methods (FPX) refuse an order without them. */
  readonly device?: { readonly userAgent?: string; readonly ip?: string };
}

/** An order as TransFi reports it now. `status` is theirs, unmapped. */
export interface OrderState {
  readonly status: string;
  readonly destinationCurrency: string;
  readonly destinationAmount: number;
}

export interface OnrampOrder {
  readonly orderId: string;
  /** TransFi's hosted pay page: the fallback for any method not drawn here. */
  readonly payUrl: string;
  readonly instructions: PaymentInstructions;
}

const PAGE_LIMIT = 50;

const pageSchema = z.object({
  data: z.array(z.unknown()),
  pagination: z.object({ hasNext: z.boolean() }).optional(),
});

const paymentMethodSchema = z.object({
  name: z.string(),
  paymentCode: z.string(),
  paymentType: z.string(),
  minAmount: z.coerce.number(),
  maxAmount: z.coerce.number(),
  logoUrl: z.string().url().optional(),
  additionalDetails: z.record(z.unknown()).optional(),
});

const currencyEntrySchema = z.object({ currency: z.string() });

const rateSchema = z.object({
  sourceAmount: z.coerce.number(),
  destinationAmount: z.coerce.number(),
  minLimit: z.coerce.number(),
  maxLimit: z.coerce.number(),
  totalFee: z.coerce.number(),
});

const userSchema = z.object({ data: z.object({ userId: z.string() }) });

const orderStateSchema = z.object({
  data: z.object({
    status: z.string(),
    destination: z.object({ currency: z.string(), amount: z.coerce.number() }),
  }),
});

const orderSchema = z.object({
  data: z.object({
    orderId: z.string(),
    payUrl: z.string().url(),
    paymentsData: z
      .object({
        type: z.string().optional(),
        qrCode: z.string().optional(),
        vaCode: z.string().optional(),
        extra: z.object({ vaBank: z.string().optional() }).passthrough().optional(),
      })
      .passthrough()
      .optional(),
  }),
});

const errorSchema = z.object({
  error: z.object({
    code: z.string().optional(),
    message: z.string().optional(),
    context: z
      .object({
        details: z
          .array(z.object({ minLimit: z.number().optional(), code: z.string().optional() }))
          .optional(),
      })
      .optional(),
  }),
});

/**
 * The amount is under what the payment method will take.
 *
 * The method list advertises a `minAmount` that is not the real floor (QRIS
 * lists 1 and refuses anything under 91,310 IDR), so the floor only shows up
 * here, in the refusal. Carried as a number so a caller can retry above it.
 */
export class BelowMinimumError extends ProviderError {
  constructor(readonly minLimit: number) {
    super(`Below the minimum order amount of ${minLimit}`, { minLimit }, { retryable: false });
  }
}

const VERIFICATION_CODES: ReadonlySet<string> = new Set([
  "EMAIL_NOT_VERIFIED",
  "PHONE_NOT_VERIFIED",
  "CONTACT_NOT_VERIFIED",
]);

/**
 * TransFi will not open an order until the user has confirmed their email or
 * phone from the link it sent at creation. That is a step the payer takes
 * elsewhere, not a failure of the request, so a caller asks the payer to do it
 * and tries again.
 */
export function needsVerification(error: unknown): boolean {
  if (!(error instanceof ProviderError)) return false;
  const codes = error.details.codes;
  return Array.isArray(codes) && codes.some((code) => VERIFICATION_CODES.has(String(code)));
}

export interface TransfiClient {
  listPaymentMethods(currency: string): Promise<readonly PaymentMethod[]>;
  /** The fiat currencies the provider takes a deposit in. */
  listDepositCurrencies(): Promise<readonly string[]>;
  quote(args: {
    readonly fiatCurrency: string;
    readonly fiatAmount: number;
    readonly cryptoCurrency: string;
    readonly paymentCode: string;
    readonly paymentType: string;
  }): Promise<RateQuote>;
  createUser(payer: PayerDetails): Promise<string>;
  getOrder(orderId: string): Promise<OrderState>;
  /**
   * Marks an on-ramp order paid and delivered, on TransFi's sandbox.
   *
   * The sandbox moves no value, so nothing else would ever settle an order
   * there. Refused outright against any other host: the guard is in the client,
   * not only in whoever calls it.
   */
  simulateSettled(orderId: string): Promise<void>;
  createOrder(order: OnrampOrderRequest): Promise<OnrampOrder>;
}

export function createTransfiClient(
  config: TransfiConfig,
  fetchImpl: FetchLike = fetch,
): TransfiClient {
  const authorization = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`;

  async function request(
    method: "GET" | "POST",
    path: string,
    options: { readonly query?: Record<string, string>; readonly body?: unknown } = {},
  ): Promise<unknown> {
    const url = new URL(path, config.baseUrl);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, value);
    }

    let response: Response;
    try {
      response = await fetchImpl(url.toString(), {
        method,
        headers: {
          Authorization: authorization,
          mid: config.mid,
          Accept: "application/json",
          ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
    } catch (cause) {
      throw new ProviderError("TransFi is unreachable", { path }, { cause, retryable: true });
    }

    const payload: unknown = await response.json().catch(() => undefined);
    if (response.ok) return payload;

    const failure = errorSchema.safeParse(payload);
    const minLimit = failure.success
      ? failure.data.error.context?.details?.find((entry) => entry.minLimit !== undefined)?.minLimit
      : undefined;
    if (
      failure.success &&
      failure.data.error.code === "QUOTES_MIN_AMOUNT_ERROR" &&
      minLimit !== undefined
    ) {
      throw new BelowMinimumError(minLimit);
    }
    const codes = failure.success
      ? (failure.data.error.context?.details ?? []).flatMap((entry) =>
          entry.code === undefined ? [] : [entry.code],
        )
      : [];
    throw new ProviderError(
      failure.success
        ? (failure.data.error.message ?? "TransFi rejected the request")
        : "TransFi rejected the request",
      {
        path,
        status: response.status,
        codes,
        ...(failure.success && failure.data.error.code !== undefined
          ? { providerCode: failure.data.error.code }
          : {}),
      },
      { retryable: response.status >= 500 },
    );
  }

  return {
    async listDepositCurrencies() {
      const currencies: string[] = [];
      for (let page = 1; ; page++) {
        const result = pageSchema.parse(
          await request("GET", "/v3/config/supported-currencies", {
            query: { direction: "deposit", limit: String(PAGE_LIMIT), page: String(page) },
          }),
        );
        for (const item of result.data) {
          currencies.push(currencyEntrySchema.parse(item).currency);
        }
        if (result.pagination?.hasNext !== true) return currencies;
      }
    },

    async listPaymentMethods(currency) {
      const methods: PaymentMethod[] = [];
      for (let page = 1; ; page++) {
        const result = pageSchema.parse(
          await request("GET", "/v3/config/payment-methods", {
            query: {
              direction: "deposit",
              currency,
              headlessMode: "true",
              limit: String(PAGE_LIMIT),
              page: String(page),
            },
          }),
        );
        for (const item of result.data) {
          const method = paymentMethodSchema.parse(item);
          methods.push({
            code: method.paymentCode,
            type: method.paymentType,
            name: method.name,
            minAmount: method.minAmount,
            maxAmount: method.maxAmount,
            logoUrl: method.logoUrl ?? null,
            fields: Object.keys(method.additionalDetails ?? {}),
          });
        }
        if (result.pagination?.hasNext !== true) return methods;
      }
    },

    async quote(args) {
      const rate = rateSchema.parse(
        await request("GET", "/v3/exchange-rates", {
          query: {
            orderType: "onramp",
            amount: String(args.fiatAmount),
            sourceCurrency: args.fiatCurrency,
            destinationCurrency: args.cryptoCurrency,
            paymentType: args.paymentType,
            paymentCode: args.paymentCode,
          },
        }),
      );
      return rate;
    },

    async createUser(payer) {
      const result = userSchema.parse(
        await request("POST", "/v3/users/individual", {
          body: {
            firstName: payer.firstName,
            lastName: payer.lastName,
            country: payer.country,
            date: payer.dateOfBirth,
            email: payer.email,
            phone: payer.phone,
            phoneCode: payer.phoneCode,
            address: payer.address,
          },
        }),
      );
      return result.data.userId;
    },

    async getOrder(orderId) {
      const result = orderStateSchema.parse(
        await request("GET", `/v3/orders/${encodeURIComponent(orderId)}`),
      );
      return {
        status: result.data.status,
        destinationCurrency: result.data.destination.currency,
        destinationAmount: result.data.destination.amount,
      };
    },

    async simulateSettled(orderId) {
      if (!new URL(config.baseUrl).hostname.includes("sandbox")) {
        throw new ConfigurationError("An order can only be simulated against TransFi's sandbox", {
          host: new URL(config.baseUrl).hostname,
        });
      }
      await request("POST", "/v3/simulation/order", {
        body: { orderId, status: "asset_settled" },
      });
    },

    async createOrder(order) {
      const result = orderSchema.parse(
        await request("POST", "/v3/orders", {
          body: {
            orderType: "onramp",
            purposeCode: "vendor_payment",
            userId: order.userId,
            partnerId: order.partnerId,
            headlessMode: true,
            successRedirectUrl: order.successRedirectUrl,
            failureRedirectUrl: order.failureRedirectUrl,
            source: {
              currency: order.fiatCurrency,
              amount: order.fiatAmount,
              paymentType: order.paymentType,
              paymentCode: order.paymentCode,
              additionalPaymentDetails: {
                ...order.details,
                ...(order.device === undefined
                  ? {}
                  : {
                      deviceDetails: {
                        ...(order.device.userAgent === undefined
                          ? {}
                          : { userAgent: order.device.userAgent }),
                        ...(order.device.ip === undefined
                          ? {}
                          : { ipInfo: { ip: order.device.ip } }),
                      },
                    }),
              },
            },
            destination: {
              currency: order.cryptoCurrency,
              walletAddress: order.walletAddress,
              additionalPaymentDetails: { walletOwner: "self", userConfirmed: true },
            },
          },
        }),
      );
      return {
        orderId: result.data.orderId,
        payUrl: result.data.payUrl,
        instructions: instructionsOf(result.data.payUrl, result.data.paymentsData),
      };
    },
  };
}
