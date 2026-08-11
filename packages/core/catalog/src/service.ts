/**
 * Commerce application services.
 *
 * `CatalogService` owns products and payment links. `CheckoutService` is the
 * one place value crosses out of the commerce layer: it prices a cart and mints
 * a Payment Intent. Nothing here settles, clears, or talks to a chain — the
 * intent is handed on and the commerce layer's job is finished.
 */

import type {
  CreatePaymentIntentCommand,
  MerchantSnapshot,
  PaymentIntent,
} from "@mayarin/payment-intent";
import {
  type AssetCode,
  type Clock,
  ConflictError,
  IdempotencyConflictError,
  type Money,
  NotFoundError,
  ValidationError,
} from "@mayarin/shared";
import { priceCart, priceIn, withCartSnapshot } from "./cart.ts";
import {
  assertPayable,
  type CreatePaymentLinkInput,
  createPaymentLink,
  disablePaymentLink,
} from "./link.ts";
import { type CreateProductInput, createProduct, updateProduct } from "./product.ts";
import type {
  ListPaymentLinksOptions,
  ListProductsOptions,
  PaymentLinkRepository,
  ProductRepository,
} from "./repository.ts";
import type { CartLine, PaymentLink, PaymentLinkLine, Product } from "./types.ts";

/**
 * The seam onto payment creation.
 *
 * Structural rather than a class reference so the commerce layer depends on the
 * shape it uses and not on how a deployment assembles it — `PaymentIntentService`
 * satisfies this, and so does a test double, without either being named here.
 */
export interface IntentMinter {
  create(command: CreatePaymentIntentCommand): Promise<PaymentIntent>;
}

export interface CatalogServiceOptions {
  readonly products: ProductRepository;
  readonly links: PaymentLinkRepository;
  readonly clock: Clock;
}

export type CreateProductCommand = Omit<CreateProductInput, "now">;
export type CreatePaymentLinkCommand = Omit<CreatePaymentLinkInput, "now">;

export interface UpdateProductCommand {
  readonly name?: string;
  /** `null` clears the description; an absent field leaves it alone. */
  readonly description?: string | null;
  readonly prices?: readonly Money[];
  readonly active?: boolean;
  readonly metadata?: Readonly<Record<string, string>>;
}

export class CatalogService {
  readonly #products: ProductRepository;
  readonly #links: PaymentLinkRepository;
  readonly #clock: Clock;

  constructor(options: CatalogServiceOptions) {
    this.#products = options.products;
    this.#links = options.links;
    this.#clock = options.clock;
  }

  async createProduct(command: CreateProductCommand): Promise<Product> {
    const existing = await this.#products.findBySku(command.merchantId, command.sku);
    if (existing !== null) {
      throw new ConflictError(
        `Merchant ${command.merchantId} already has a product with SKU "${command.sku}"`,
        { merchantId: command.merchantId, sku: command.sku, productId: existing.id },
      );
    }

    const product = createProduct({ ...command, now: this.#clock.now() });
    await this.#products.insert(product);
    return product;
  }

  async getProduct(id: string): Promise<Product> {
    const product = await this.#products.findById(id);
    if (product === null) {
      throw new NotFoundError(`Product ${id} not found`, { id });
    }
    return product;
  }

  async listProducts(options: ListProductsOptions): Promise<readonly Product[]> {
    return this.#products.list(options);
  }

  async updateProduct(id: string, patch: UpdateProductCommand): Promise<Product> {
    const product = await this.getProduct(id);
    const next = updateProduct(product, patch, this.#clock.now());
    await this.#products.update(next, product.version);
    return next;
  }

  /**
   * Creates a link.
   *
   * With an idempotency key, replaying the same request returns the original
   * link; reusing the key for a different link is refused rather than quietly
   * handing back something the caller did not ask for. The same rule the intent
   * service applies, for the same reason — a retried POST must not double.
   */
  async createLink(command: CreatePaymentLinkCommand): Promise<PaymentLink> {
    if (command.idempotencyKey !== undefined) {
      const existing = await this.#links.findByIdempotencyKey(command.idempotencyKey);
      if (existing !== null) {
        if (existing.kind !== command.kind || existing.merchant.id !== command.merchant.id) {
          throw new IdempotencyConflictError(
            `Idempotency key "${command.idempotencyKey}" was already used with different parameters`,
            { idempotencyKey: command.idempotencyKey, existingLinkId: existing.id },
          );
        }
        return existing;
      }
    }

    const link = createPaymentLink({ ...command, now: this.#clock.now() });
    await this.#links.insert(link);
    return link;
  }

  async getLink(id: string): Promise<PaymentLink> {
    const link = await this.#links.findById(id);
    if (link === null) {
      throw new NotFoundError(`Payment link ${id} not found`, { id });
    }
    return link;
  }

  async listLinks(options: ListPaymentLinksOptions): Promise<readonly PaymentLink[]> {
    return this.#links.list(options);
  }

  async disableLink(id: string): Promise<PaymentLink> {
    const link = await this.getLink(id);
    const next = disablePaymentLink(link, this.#clock.now());
    if (next === link) return link;
    await this.#links.update(next, link.version);
    return next;
  }
}

/** A cart line as a caller submits it: either a catalog reference or an ad-hoc line. */
export type CheckoutLineInput =
  | { readonly productId: string; readonly quantity: number }
  | { readonly name: string; readonly unitPrice: Money; readonly quantity: number };

/** Everything a checkout may carry through to the intent it mints. */
interface IntentOptions {
  readonly settlementAsset?: CreatePaymentIntentCommand["settlementAsset"];
  readonly provider?: string;
  readonly payment?: CreatePaymentIntentCommand["payment"];
  readonly executionPath?: CreatePaymentIntentCommand["executionPath"];
  readonly metadata?: Readonly<Record<string, string>>;
  readonly merchantReference?: string;
  readonly idempotencyKey?: string;
  readonly ttlSeconds?: number;
}

export interface CheckoutCartCommand extends IntentOptions {
  readonly merchant: MerchantSnapshot;
  readonly currency: AssetCode;
  readonly lines: readonly CheckoutLineInput[];
}

/** What a link costs, and what makes up that cost. */
export interface LinkPreview {
  readonly lines: readonly CartLine[];
  readonly currency: AssetCode;
  readonly total: Money;
}

export interface CheckoutLinkCommand extends IntentOptions {
  /** Required by an `open` link, refused by the others — they price themselves. */
  readonly amount?: Money;
}

export interface CheckoutServiceOptions {
  readonly products: ProductRepository;
  readonly links: PaymentLinkRepository;
  readonly intents: IntentMinter;
  readonly clock: Clock;
}

export class CheckoutService {
  readonly #products: ProductRepository;
  readonly #links: PaymentLinkRepository;
  readonly #intents: IntentMinter;
  readonly #clock: Clock;

  constructor(options: CheckoutServiceOptions) {
    this.#products = options.products;
    this.#links = options.links;
    this.#intents = options.intents;
    this.#clock = options.clock;
  }

  /** Prices a cart and mints one intent for the total. */
  async checkoutCart(command: CheckoutCartCommand): Promise<PaymentIntent> {
    const lines = await resolveLines(
      this.#products,
      command.merchant.id,
      command.lines,
      command.currency,
    );
    return this.#mint(command.merchant, lines, command.currency, command);
  }

  /**
   * Prices a link without minting anything.
   *
   * The hosted checkout shows a buyer what they are about to pay for *before*
   * they commit, and a catalog link's total lives in the products rather than
   * on the link — so the page cannot add it up on its own. Minting an intent to
   * find out would lock a price and burn a deposit address for a buyer who has
   * not decided yet.
   *
   * Same pricing path as `checkoutLink`, so the preview and the payment agree.
   */
  async previewLink(linkId: string, amount?: Money): Promise<LinkPreview> {
    const link = await this.#links.findById(linkId);
    if (link === null) {
      throw new NotFoundError(`Payment link ${linkId} not found`, { id: linkId });
    }
    return priceLink(this.#products, link, amount);
  }

  /** Mints an intent from a link, in whichever shape the link takes. */
  async checkoutLink(linkId: string, command: CheckoutLinkCommand = {}): Promise<PaymentIntent> {
    const link = await this.#links.findById(linkId);
    if (link === null) {
      throw new NotFoundError(`Payment link ${linkId} not found`, { id: linkId });
    }
    assertPayable(link, this.#clock.now());

    const { lines, currency } = await linkLines(this.#products, link, command.amount);

    const merchantReference = command.merchantReference ?? link.merchantReference;

    return this.#mint(link.merchant, lines, currency, {
      ...command,
      // The link's own metadata is the default; a per-checkout value overrides
      // it, and `paymentLinkId` is ours to set last so neither can forge it.
      metadata: { ...link.metadata, ...command.metadata, paymentLinkId: link.id },
      ...(merchantReference === undefined ? {} : { merchantReference }),
    });
  }

  async #mint(
    merchant: MerchantSnapshot,
    lines: readonly CartLine[],
    currency: AssetCode,
    options: IntentOptions,
  ): Promise<PaymentIntent> {
    const total = priceCart(lines, currency);

    return this.#intents.create({
      merchant,
      amount: total.total,
      source: { type: "manual" },
      metadata: withCartSnapshot(options.metadata, total),
      ...(options.settlementAsset === undefined
        ? {}
        : { settlementAsset: options.settlementAsset }),
      ...(options.provider === undefined ? {} : { provider: options.provider }),
      ...(options.payment === undefined ? {} : { payment: options.payment }),
      ...(options.executionPath === undefined ? {} : { executionPath: options.executionPath }),
      ...(options.merchantReference === undefined
        ? {}
        : { merchantReference: options.merchantReference }),
      ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
      ...(options.ttlSeconds === undefined ? {} : { ttlSeconds: options.ttlSeconds }),
    });
  }
}

/**
 * The priced lines a link stands for.
 *
 * A free function rather than a method because two services need it and only
 * one of them mints payments: the dashboard prices a link to show a counter
 * what it costs, and threading an `IntentMinter` through that surface would be
 * inventing a dependency to reach a pure calculation.
 */
export async function linkLines(
  products: ProductRepository,
  link: PaymentLink,
  amount: Money | undefined,
): Promise<{ lines: readonly CartLine[]; currency: AssetCode }> {
  switch (link.kind) {
    case "fixed": {
      // Narrowed by `createPaymentLink`, which refuses a fixed link without one.
      const fixed = link.amount;
      if (fixed === undefined) {
        throw new ValidationError(`Payment link ${link.id} is missing its amount`, {
          id: link.id,
        });
      }
      if (amount !== undefined) {
        throw new ValidationError(
          `Payment link ${link.id} has a fixed amount and cannot be overridden`,
          { id: link.id },
        );
      }
      return {
        lines: [{ name: link.title ?? "Payment", unitPrice: fixed, quantity: 1 }],
        currency: fixed.asset,
      };
    }
    case "open": {
      const currency = link.currency;
      if (currency === undefined) {
        throw new ValidationError(`Payment link ${link.id} is missing its currency`, {
          id: link.id,
        });
      }
      if (amount === undefined) {
        throw new ValidationError(`Payment link ${link.id} requires an amount`, { id: link.id });
      }
      if (amount.asset !== currency) {
        throw new ValidationError(
          `Payment link ${link.id} is denominated in ${currency}, not ${amount.asset}`,
          { id: link.id, currency, submitted: amount.asset },
        );
      }
      return {
        lines: [{ name: link.title ?? "Payment", unitPrice: amount, quantity: 1 }],
        currency,
      };
    }
    case "catalog": {
      const currency = link.currency;
      if (currency === undefined || link.lines === undefined) {
        throw new ValidationError(`Payment link ${link.id} is missing its catalog lines`, {
          id: link.id,
        });
      }
      if (amount !== undefined) {
        throw new ValidationError(
          `Payment link ${link.id} is priced from the catalog and cannot be overridden`,
          { id: link.id },
        );
      }
      const lines = await resolveLines(products, link.merchant.id, link.lines, currency);
      return { lines, currency };
    }
  }
}

/**
 * Turns submitted lines into priced ones.
 *
 * A catalog reference is resolved now and frozen: the unit price that reaches
 * the intent is the one that was live at checkout, and a later price edit
 * cannot reach back into a payment already under way.
 */
export async function resolveLines(
  products: ProductRepository,
  merchantId: string,
  lines: readonly (CheckoutLineInput | PaymentLinkLine)[],
  currency: AssetCode,
): Promise<readonly CartLine[]> {
  const ids = lines
    .map((line) => ("productId" in line ? line.productId : undefined))
    .filter((id): id is string => id !== undefined);

  const byId = new Map(
    ids.length === 0
      ? []
      : (await products.findManyById(ids)).map((product) => [product.id, product] as const),
  );

  return lines.map((line) => {
    if (!("productId" in line)) {
      return { name: line.name, unitPrice: line.unitPrice, quantity: line.quantity };
    }

    const product = byId.get(line.productId);
    if (product === undefined) {
      throw new NotFoundError(`Product ${line.productId} not found`, { id: line.productId });
    }
    if (product.merchantId !== merchantId) {
      throw new ValidationError(`Product ${product.id} belongs to another merchant`, {
        productId: product.id,
        merchantId,
      });
    }
    if (!product.active) {
      throw new ValidationError(`Product ${product.id} is not for sale`, {
        productId: product.id,
      });
    }

    const unitPrice = priceIn(product.prices, currency);
    if (unitPrice === undefined) {
      throw new ValidationError(`Product ${product.id} has no price in ${currency}`, {
        productId: product.id,
        currency,
        pricedIn: product.prices.map((price) => price.asset),
      });
    }

    return { productId: product.id, name: product.name, unitPrice, quantity: line.quantity };
  });
}

/** What a link costs right now, lines and all, without minting anything. */
export async function priceLink(
  products: ProductRepository,
  link: PaymentLink,
  amount?: Money,
): Promise<LinkPreview> {
  const { lines, currency } = await linkLines(products, link, amount);
  return { lines, currency, total: priceCart(lines, currency).total };
}
