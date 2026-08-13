import { CheckoutButton } from "./CheckoutButton.tsx";
import type { DemoProduct } from "./types.ts";

/** The demo prices in IDR only; a product without an IDR price is not shown as payable. */
const CURRENCY = "IDR";

export function ProductCard({ product }: { readonly product: DemoProduct }) {
  const price = product.prices.find((entry) => entry.asset === CURRENCY);

  return (
    <li className="card">
      <h2>{product.name}</h2>
      {product.description !== null && <p className="description">{product.description}</p>}
      {price === undefined ? (
        <p className="notice">No {CURRENCY} price.</p>
      ) : (
        <>
          <p className="price">{price.display}</p>
          <CheckoutButton productId={product.id} />
        </>
      )}
    </li>
  );
}
