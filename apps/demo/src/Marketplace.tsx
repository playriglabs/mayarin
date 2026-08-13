import { useEffect, useState } from "react";
import { ProductCard } from "./ProductCard.tsx";
import type { DemoProduct } from "./types.ts";

type CatalogState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly products: readonly DemoProduct[] };

export function Marketplace() {
  const [catalog, setCatalog] = useState<CatalogState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/products")
      .then(async (response) => {
        if (!response.ok) {
          const body = (await response.json().catch(() => undefined)) as
            | { error?: string }
            | undefined;
          throw new Error(body?.error ?? `The demo server answered HTTP ${response.status}`);
        }
        return (await response.json()) as { products: readonly DemoProduct[] };
      })
      .then((body) => {
        if (!cancelled) setCatalog({ status: "ready", products: body.products });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setCatalog({
            status: "error",
            message: error instanceof Error ? error.message : "Could not load the catalog.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="marketplace">
      <header>
        <h1>Toko Demo</h1>
        <p>Oleh-oleh khas Nusantara. Pilih produk, lalu bayar.</p>
      </header>
      {catalog.status === "loading" && <p className="notice">Loading the catalog…</p>}
      {catalog.status === "error" && <p className="notice error">{catalog.message}</p>}
      {catalog.status === "ready" && catalog.products.length === 0 && (
        <p className="notice">No products yet. Run `bun run seed` in apps/demo.</p>
      )}
      {catalog.status === "ready" && catalog.products.length > 0 && (
        <ul className="grid">
          {catalog.products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </ul>
      )}
    </main>
  );
}
