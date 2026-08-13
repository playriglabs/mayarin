import { CheckoutButton } from "./CheckoutButton.tsx";
import { GarmentArt } from "./garments.tsx";
import type { DemoProduct } from "./types.ts";

/** The demo prices in IDR only; a product without an IDR price is not payable. */
const CURRENCY = "IDR";

export function ProductCard({ product }: { readonly product: DemoProduct }) {
  const price = product.prices.find((entry) => entry.asset === CURRENCY);

  return (
    <li className="card">
      <div className="art">
        <GarmentArt kind={product.metadata.kind} />
      </div>
      <h2>{product.name}</h2>
      {product.description !== null && <p className="description">{product.description}</p>}
      {price === undefined ? (
        <p className="notice">Belum ada harga.</p>
      ) : (
        <div className="buy">
          <p className="price">{price.display}</p>
          <CheckoutButton productId={product.id} productName={product.name} />
        </div>
      )}
    </li>
  );
}
