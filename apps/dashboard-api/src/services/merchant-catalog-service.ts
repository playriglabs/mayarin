/**
 * Merchant-scoped commerce surface (#15).
 *
 * The payment API already exposes the whole commerce layer, but every route
 * there takes the merchant as an argument — right for an SDK consumer holding
 * their own credentials, wrong for a dashboard, where the merchant is whoever
 * is signed in. This service is the same `CatalogService` with the merchant
 * taken from the session instead of from the request.
 *
 * Every method takes a `Scope` and never a merchant id. A product or link
 * belonging to another merchant resolves to the same `NotFoundError` an absent
 * id would, so a not-found and a forbidden are indistinguishable on the wire.
 *
 * It mints no Payment Intents. The dashboard's job ends at the link; the buyer
 * opening that link is what mints an intent, and that happens on the payment
 * API where the clearing engine lives.
 */

import type { Merchant } from "@mayarin/auth";
import {
  type CatalogService,
  type CreatePaymentLinkCommand,
  type LinkPreview,
  type PaymentLink,
  type Product,
  type ProductRepository,
  priceLink,
  type UpdateProductCommand,
} from "@mayarin/catalog";
import type { MerchantSnapshot } from "@mayarin/payment-intent";
import { type Money, NotFoundError, ValidationError } from "@mayarin/shared";
import type { Scope } from "../dto/auth.ts";
import { cursorPage, DEFAULT_PAGE_SIZE, decodeCursor } from "../pagination.ts";
import type { MerchantSettingsService } from "./merchant-settings-service.ts";

export interface MerchantCatalogServiceOptions {
  readonly catalog: CatalogService;
  /** Where the merchant record comes from — the snapshot a link freezes. */
  readonly settings: MerchantSettingsService;
  /**
   * Products, for pricing a catalog link.
   *
   * A catalog link carries no amount — its price lives in the products it
   * names — so the counter cannot quote one without resolving them. The same
   * function the payment API prices with, so the figure shown at the counter is
   * the figure the payment locks.
   */
  readonly products: ProductRepository;
}

export interface CreateProductInput {
  readonly sku: string;
  readonly name: string;
  readonly description?: string;
  readonly prices: readonly Money[];
  readonly metadata?: Readonly<Record<string, string>>;
}

/** A link as the dashboard asks for one: no merchant, it is the caller's own. */
export type CreateLinkInput = Omit<CreatePaymentLinkCommand, "merchant">;

export class MerchantCatalogService {
  readonly #catalog: CatalogService;
  readonly #settings: MerchantSettingsService;
  readonly #products: ProductRepository;

  constructor(options: MerchantCatalogServiceOptions) {
    this.#catalog = options.catalog;
    this.#settings = options.settings;
    this.#products = options.products;
  }

  /**
   * What a link costs, without minting anything.
   *
   * `amount` is what the counter typed, required by an `open` link and refused
   * by the others — the same rule the payment API applies when it mints, since
   * both go through `priceLink`.
   */
  async previewLink(scope: Scope, id: string, amount?: Money): Promise<LinkPreview> {
    const link = await this.getLink(scope, id);
    return priceLink(this.#products, link, amount);
  }

  /**
   * Whether the link's current catalog dependencies can still produce a price.
   *
   * A catalog link deliberately stores product references rather than a frozen
   * amount. Removing its currency or archiving one of its products therefore
   * makes it temporarily unavailable; restoring the dependency makes it
   * available again. Infrastructure failures still surface instead of being
   * mislabeled as a retired link.
   */
  async isLinkPriceable(link: PaymentLink): Promise<boolean> {
    if (link.kind === "open") return true;
    try {
      await priceLink(this.#products, link);
      return true;
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof ValidationError) return false;
      throw error;
    }
  }

  async listProducts(
    scope: Scope,
    filter: { readonly active?: boolean; readonly limit?: number; readonly cursor?: string } = {},
  ) {
    const limit = Math.min(filter.limit ?? DEFAULT_PAGE_SIZE, DEFAULT_PAGE_SIZE);
    const cursor = decodeCursor(filter.cursor);
    const products = await this.#catalog.listProducts({
      merchantId: scope.merchantId,
      limit: limit + 1,
      active: filter.active ?? true,
      ...(cursor === undefined ? {} : { cursor }),
    });
    return cursorPage(products, limit, (last) => ({ id: last.id, createdAt: last.createdAt }));
  }

  async createProduct(scope: Scope, input: CreateProductInput): Promise<Product> {
    return this.#catalog.createProduct({ ...input, merchantId: scope.merchantId });
  }

  async getProduct(scope: Scope, id: string): Promise<Product> {
    const product = await this.#catalog.getProduct(id);
    if (product.merchantId !== scope.merchantId) {
      throw new NotFoundError(`Product ${id} not found`, { id });
    }
    return product;
  }

  async updateProduct(scope: Scope, id: string, patch: UpdateProductCommand): Promise<Product> {
    // Loaded through the scoped getter first, so another merchant's product is
    // never reached by the update — the ownership check is not optional here.
    await this.getProduct(scope, id);
    return this.#catalog.updateProduct(id, patch);
  }

  async listProductOptions(scope: Scope): Promise<readonly Product[]> {
    const items: Product[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.listProducts(scope, {
        active: true,
        ...(cursor === undefined ? {} : { cursor }),
      });
      items.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    return items;
  }

  async listLinks(
    scope: Scope,
    filter: { readonly limit?: number; readonly cursor?: string } = {},
  ) {
    const limit = Math.min(filter.limit ?? DEFAULT_PAGE_SIZE, DEFAULT_PAGE_SIZE);
    const cursor = decodeCursor(filter.cursor);
    const links = await this.#catalog.listLinks({
      merchantId: scope.merchantId,
      limit: limit + 1,
      ...(cursor === undefined ? {} : { cursor }),
    });
    return cursorPage(links, limit, (last) => ({ id: last.id, createdAt: last.createdAt }));
  }

  async getLink(scope: Scope, id: string): Promise<PaymentLink> {
    const link = await this.#catalog.getLink(id);
    if (link.merchant.id !== scope.merchantId) {
      throw new NotFoundError(`Payment link ${id} not found`, { id });
    }
    return link;
  }

  /**
   * Mints a link for the caller's own merchant.
   *
   * The snapshot is built from the merchant record rather than accepted from
   * the request: a buyer is shown the merchant's name and city, and a field a
   * client can set is a field a client can misstate.
   */
  async createLink(scope: Scope, input: CreateLinkInput): Promise<PaymentLink> {
    const merchant = await this.#settings.get(scope);
    // A catalog link names product ids, and ownership of those is only checked
    // at checkout — where the person who finds out is the buyer, staring at a
    // link that was accepted, listed and printed as a QR. Checked here so the
    // merchant who typed the wrong id is the one told about it.
    for (const line of input.lines ?? []) await this.getProduct(scope, line.productId);

    return this.#catalog.createLink({ ...input, merchant: toSnapshot(merchant) });
  }

  async disableLink(scope: Scope, id: string): Promise<PaymentLink> {
    await this.getLink(scope, id);
    return this.#catalog.disableLink(id);
  }
}

/**
 * The merchant as a buyer is shown them.
 *
 * `city` and `countryCode` are nullable on the record and required in the
 * snapshot, and that gap is deliberate: a merchant exists before anyone has
 * filled in their profile, and the first moment it matters is the first link
 * they mint. Refusing here names the missing field, where a merchant can act on
 * it; letting a blank through would freeze it into every intent the link mints.
 */
function toSnapshot(merchant: Merchant): MerchantSnapshot {
  const { city, countryCode } = merchant;
  if (city === undefined || countryCode === undefined) {
    const missing = [
      ...(city === undefined ? ["city"] : []),
      ...(countryCode === undefined ? ["country"] : []),
    ];
    throw new ValidationError(
      `Set your ${missing.join(" and ")} in settings before creating a payment link`,
      { merchantId: merchant.id, missing },
    );
  }

  return { id: merchant.id, name: merchant.name, city, countryCode };
}
