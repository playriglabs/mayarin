import { useMemo, useState } from "react";
import { LogoMark } from "./brand.tsx";
import { Hero } from "./Hero.tsx";
import { ProductCard } from "./ProductCard.tsx";
import { ProductDialog } from "./ProductDialog.tsx";
import type { CatalogState, DemoProduct } from "./types.ts";

const SKELETON_SLOTS = ["s1", "s2", "s3", "s4", "s5", "s6"] as const;
const ALL = "All";

/** Hand-dyed cloth from the catalog photography — reused for the workshop story. */
const WORKSHOP_IMAGE =
  "https://images.unsplash.com/photo-1561578428-c59823044e25?auto=format&fit=crop&w=1200&q=82";

export function Marketplace({
  catalog,
  addToCart,
  onBuyNow,
}: {
  readonly catalog: CatalogState;
  readonly addToCart: (product: DemoProduct, quantity: number) => void;
  readonly onBuyNow: (product: DemoProduct, quantity: number) => void;
}) {
  const [category, setCategory] = useState<string>(ALL);
  const [selected, setSelected] = useState<DemoProduct | undefined>(undefined);

  const products = catalog.status === "ready" ? catalog.products : [];

  const categories = useMemo(() => {
    const found = [...new Set(products.map((p) => p.metadata.category).filter(Boolean))];
    return [ALL, ...found] as readonly string[];
  }, [products]);

  const tiles = useMemo(
    () =>
      categories
        .filter((entry) => entry !== ALL)
        .map((entry) => ({
          category: entry,
          image: products.find((p) => p.metadata.category === entry)?.metadata.image,
        })),
    [categories, products],
  );

  const visible =
    category === ALL ? products : products.filter((p) => p.metadata.category === category);

  return (
    <>
      <a className="skip-link" href="#koleksi">
        Skip to the collection
      </a>

      <Hero products={products} onView={setSelected} />

      <section className="featured">
        <div className="section-head">
          <div>
            <p className="kicker">This month</p>
            <h2>New drop</h2>
          </div>
          <a className="see-all" href="#koleksi">
            See all products
          </a>
        </div>
        {catalog.status === "ready" ? (
          <ul className="featured-row">
            {products.slice(0, 4).map((product) => (
              <ProductCard key={product.id} product={product} onOpen={() => setSelected(product)} />
            ))}
          </ul>
        ) : (
          <ul className="featured-row" aria-hidden="true">
            {SKELETON_SLOTS.slice(0, 4).map((slot) => (
              <li key={slot} className="card skeleton">
                <div className="media" />
                <div className="line title" />
                <div className="line price" />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="categories" id="kategori">
        <div className="section-head">
          <div>
            <p className="kicker">Browse</p>
            <h2>Shop by category</h2>
          </div>
        </div>
        {catalog.status === "ready" ? (
          <ul className="tile-grid">
            {tiles.map((tile) => (
              <li key={tile.category}>
                <button
                  type="button"
                  className="tile group"
                  onClick={() => {
                    setCategory(tile.category);
                    document.getElementById("koleksi")?.scrollIntoView();
                  }}
                >
                  <img src={tile.image} alt="" loading="lazy" decoding="async" />
                  <span className="tile-scrim" aria-hidden="true" />
                  <span className="tile-label">{tile.category}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="tile-grid" aria-hidden="true">
            {SKELETON_SLOTS.map((slot) => (
              <li key={slot} className="tile skeleton-tile" />
            ))}
          </ul>
        )}
      </section>

      <main className="shop" id="koleksi">
        <div className="shop-head">
          <div className="flex flex-col gap-2">
            <h2>Collection</h2>
            {catalog.status === "ready" && (
              <p className="result-count" aria-live="polite">
                {visible.length} {visible.length === 1 ? "product" : "products"}
                {category === ALL ? "" : ` · ${category}`}
              </p>
            )}
          </div>
          {catalog.status === "ready" && (
            <fieldset className="filters">
              {categories.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  className={entry === category ? "chip active" : "chip"}
                  aria-pressed={entry === category}
                  onClick={() => setCategory(entry)}
                >
                  {entry === category && <span className="chip-dot" aria-hidden="true" />}
                  {entry}
                </button>
              ))}
            </fieldset>
          )}
        </div>

        {catalog.status === "loading" && (
          <ul className="grid" aria-hidden="true">
            {SKELETON_SLOTS.map((slot) => (
              <li key={slot} className="card skeleton">
                <div className="media" />
                <div className="line title" />
                <div className="line" />
                <div className="line price" />
              </li>
            ))}
          </ul>
        )}
        {catalog.status === "error" && (
          <div className="state-panel">
            <p className="notice error" role="alert">
              {catalog.message}
            </p>
          </div>
        )}
        {catalog.status === "ready" && visible.length === 0 && (
          <div className="state-panel">
            <p className="notice">There are no products in this category yet.</p>
          </div>
        )}
        {catalog.status === "ready" && visible.length > 0 && (
          <ul className="grid">
            {visible.map((product) => (
              <ProductCard key={product.id} product={product} onOpen={() => setSelected(product)} />
            ))}
          </ul>
        )}
      </main>

      <section className="about" id="tentang">
        <figure className="about-media">
          <img
            src={WORKSHOP_IMAGE}
            alt="Folded hand-dyed cloth from the workshop"
            loading="lazy"
            decoding="async"
          />
        </figure>
        <div className="about-body">
          <p className="kicker">The workshop</p>
          <h2>Made by Bandung hands</h2>
          <p>
            Parahyangan Supply began at a single printing table in Buah Batu. Every piece is still
            cut, sewn, printed, and packed by neighboring Bandung workshops.
          </p>
          <dl className="facts">
            <div>
              <dt>Store</dt>
              <dd>Jl. Braga No. 2, Bandung</dd>
            </div>
            <div>
              <dt>Opening hours</dt>
              <dd>Monday–Saturday, 10:00–21:00 WIB</dd>
            </div>
            <div>
              <dt>Contact</dt>
              <dd>halo@parahyangansupply.id</dd>
            </div>
          </dl>
        </div>
      </section>

      <footer className="colophon">
        <span className="colophon-mark">
          <LogoMark size={28} />
        </span>
        <p>© 2026 Parahyangan Supply, Bandung.</p>
      </footer>

      {selected !== undefined && (
        <ProductDialog
          product={selected}
          onAddToCart={addToCart}
          onBuyNow={(product, quantity) => {
            setSelected(undefined);
            onBuyNow(product, quantity);
          }}
          onClose={() => setSelected(undefined)}
        />
      )}
    </>
  );
}
