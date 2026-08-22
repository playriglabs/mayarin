import { ProductImage } from "./product-art.tsx";
import type { DemoProduct } from "./types.ts";

/** The store prices in IDR only; a product without an IDR price is not payable. */
export const CURRENCY = "IDR";

export function ProductCard({
  product,
  onOpen,
}: {
  readonly product: DemoProduct;
  readonly onOpen: () => void;
}) {
  const price = product.prices.find((entry) => entry.asset === CURRENCY);
  const category = product.metadata.category;

  return (
    <li className="card">
      <button type="button" className="card-open group" onClick={onOpen}>
        <div className="media">
          <ProductImage
            image={product.metadata.image}
            kind={product.metadata.kind}
            tone={product.metadata.tone}
            name={product.name}
          />
          {category !== undefined && <span className="tag">{category}</span>}
        </div>
        <h3>{product.name}</h3>
        {product.description !== null && <p className="description">{product.description}</p>}
        {price === undefined ? (
          <p className="notice">Price unavailable.</p>
        ) : (
          <p className="price">{price.display}</p>
        )}
      </button>
    </li>
  );
}
