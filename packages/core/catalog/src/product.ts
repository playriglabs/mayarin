/**
 * Product creation and edits.
 *
 * Pure functions over immutable values: an edit returns a new product with a
 * bumped `version`, which is the optimistic-locking token the repository takes.
 */

import { generateId, isPositive, type Money, ValidationError } from "@mayarin/shared";
import type { Product } from "./types.ts";

export interface CreateProductInput {
  readonly merchantId: string;
  readonly sku: string;
  readonly name: string;
  readonly description?: string;
  readonly prices: readonly Money[];
  readonly metadata?: Readonly<Record<string, string>>;
  readonly now: Date;
}

export function createProduct(input: CreateProductInput): Product {
  assertPrices(input.prices);

  const createdAt = new Date(input.now);

  return {
    id: generateId("prd", createdAt.getTime()),
    merchantId: input.merchantId,
    sku: input.sku,
    name: input.name,
    ...(input.description === undefined ? {} : { description: input.description }),
    prices: input.prices,
    active: true,
    metadata: input.metadata ?? {},
    createdAt,
    updatedAt: createdAt,
    version: 1,
  };
}

export interface UpdateProductInput {
  readonly name?: string;
  /**
   * `null` clears the description, an absent field leaves it alone.
   *
   * The same rule a merchant's settlement address follows, and for the same
   * reason: the two are different requests, and without the distinction a
   * merchant who empties the field is told they succeeded and then watches the
   * old text come back on the next read.
   */
  readonly description?: string | null;
  readonly prices?: readonly Money[];
  readonly active?: boolean;
  readonly metadata?: Readonly<Record<string, string>>;
}

export function updateProduct(product: Product, patch: UpdateProductInput, now: Date): Product {
  if (patch.prices !== undefined) assertPrices(patch.prices);

  // Destructured away rather than spread over: `...product` would carry the
  // existing description through, so clearing it would leave it in place.
  const { description: _previous, ...rest } = product;
  const description = patch.description === undefined ? product.description : patch.description;

  return {
    ...rest,
    ...(patch.name === undefined ? {} : { name: patch.name }),
    ...(description === null || description === undefined ? {} : { description }),
    ...(patch.prices === undefined ? {} : { prices: patch.prices }),
    ...(patch.active === undefined ? {} : { active: patch.active }),
    ...(patch.metadata === undefined ? {} : { metadata: patch.metadata }),
    updatedAt: new Date(now),
    version: product.version + 1,
  };
}

/**
 * A product must be priced in at least one currency, positively, and at most
 * once per currency — two prices in the same currency is an ambiguity no
 * checkout can resolve, so it is refused at the point of entry rather than
 * decided arbitrarily later.
 */
function assertPrices(prices: readonly Money[]): void {
  if (prices.length === 0) {
    throw new ValidationError("A product must carry at least one price", {});
  }

  const seen = new Set<string>();
  for (const price of prices) {
    if (!isPositive(price)) {
      throw new ValidationError(`Price in ${price.asset} must be greater than zero`, {
        asset: price.asset,
        amount: price.amount.toString(),
      });
    }
    if (seen.has(price.asset)) {
      throw new ValidationError(`Product is priced twice in ${price.asset}`, {
        asset: price.asset,
      });
    }
    seen.add(price.asset);
  }
}
