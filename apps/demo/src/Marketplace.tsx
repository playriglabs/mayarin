import { useEffect, useState } from "react";
import { ProductCard } from "./ProductCard.tsx";
import type { DemoProduct } from "./types.ts";

type CatalogState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly products: readonly DemoProduct[] };

const SKELETON_SLOTS = ["s1", "s2", "s3", "s4", "s5", "s6"] as const;

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
    <>
      <header className="masthead">
        <p className="brand">Parahyangan Supply</p>
        <p className="tagline">Bandung, est. 2026</p>
      </header>

      <section className="hero">
        <h1>
          Apparel dari Bandung.
          <br />
          <em>Dibayar dalam rupiah.</em>
        </h1>
        <p>
          Koleksi distro — kaos, hoodie, flanel — dinamai dari jalan-jalan kota kembang. Pilih satu,
          bayar, selesai.
        </p>
      </section>

      <main className="shop">
        {catalog.status === "loading" && (
          <ul className="grid" aria-hidden="true">
            {SKELETON_SLOTS.map((slot) => (
              <li key={slot} className="card skeleton">
                <div className="art" />
                <div className="line title" />
                <div className="line" />
                <div className="line price" />
              </li>
            ))}
          </ul>
        )}
        {catalog.status === "error" && (
          <p className="notice error" role="alert">
            {catalog.message}
          </p>
        )}
        {catalog.status === "ready" && catalog.products.length === 0 && (
          <p className="notice">Rak masih kosong. Run `bun run seed` in apps/demo.</p>
        )}
        {catalog.status === "ready" && catalog.products.length > 0 && (
          <ul className="grid">
            {catalog.products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </ul>
        )}
      </main>

      <footer className="colophon">
        <p>Parahyangan Supply — toko demo. Pembayaran oleh Mayarin.</p>
      </footer>
    </>
  );
}
