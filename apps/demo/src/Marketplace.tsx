import { useEffect, useMemo, useState } from "react";
import { HeroArt, LogoLockup, LogoMark } from "./brand.tsx";
import { CartDrawer, type CartLine } from "./CartDrawer.tsx";
import { formatTime, loadHistory, type PurchaseEntry } from "./history.ts";
import { ProductCard } from "./ProductCard.tsx";
import { ProductDialog } from "./ProductDialog.tsx";
import type { DemoProduct } from "./types.ts";

type CatalogState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly products: readonly DemoProduct[] };

const SKELETON_SLOTS = ["s1", "s2", "s3", "s4", "s5", "s6"] as const;
const ALL = "All";

export function Marketplace() {
  const [catalog, setCatalog] = useState<CatalogState>({ status: "loading" });
  const [category, setCategory] = useState<string>(ALL);
  const [selected, setSelected] = useState<DemoProduct | undefined>(undefined);
  const [history, setHistory] = useState<readonly PurchaseEntry[]>([]);
  const [cart, setCart] = useState<readonly CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);

  useEffect(() => {
    setHistory(loadHistory());
    let cancelled = false;
    fetch("/api/products")
      .then(async (response) => {
        if (!response.ok) {
          const body = (await response.json().catch(() => undefined)) as
            | { error?: string }
            | undefined;
          throw new Error(body?.error ?? `HTTP ${response.status}`);
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
            message:
              error instanceof Error
                ? `The catalog could not be loaded. ${error.message}`
                : "The catalog could not be loaded.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const products = catalog.status === "ready" ? catalog.products : [];

  const categories = useMemo(() => {
    const found = [...new Set(products.map((p) => p.metadata.category).filter(Boolean))];
    return [ALL, ...found] as readonly string[];
  }, [products]);

  const visible =
    category === ALL ? products : products.filter((p) => p.metadata.category === category);
  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0);

  const addToCart = (product: DemoProduct, quantity: number) => {
    setCart((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      return existing === undefined
        ? [...current, { product, quantity }]
        : current.map((line) =>
            line.product.id === product.id
              ? { ...line, quantity: Math.min(9, line.quantity + quantity) }
              : line,
          );
    });
    setCartOpen(true);
  };

  return (
    <>
      <header className="masthead">
        <a href="#atas" className="brand-link" aria-label="Parahyangan Supply">
          <LogoLockup />
        </a>
        <nav aria-label="Utama">
          <a href="#koleksi">Collection</a>
          <a href="#riwayat">History</a>
          <a href="#tentang">About</a>
          <button type="button" className="cart-trigger" onClick={() => setCartOpen(true)}>
            Cart <span>{cartCount}</span>
          </button>
        </nav>
      </header>

      <section className="hero" id="atas">
        <div className="hero-copy">
          <p className="kicker">Independent label · Bandung</p>
          <h1>
            Small releases,
            <br />
            <em>made in Bandung.</em>
          </h1>
          <p className="lede">
            Indonesian textiles meet everyday streetwear. Every piece is cut, sewn, and finished
            locally in small batches that are never reproduced.
          </p>
          <a className="cta" href="#koleksi">
            Shop the collection
          </a>
        </div>
        <HeroArt />
      </section>

      <main className="shop" id="koleksi">
        <div className="shop-head">
          <h2>Collection</h2>
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
          <p className="notice error" role="alert">
            {catalog.message}
          </p>
        )}
        {catalog.status === "ready" && visible.length === 0 && (
          <p className="notice">There are no products in this category yet.</p>
        )}
        {catalog.status === "ready" && visible.length > 0 && (
          <ul className="grid">
            {visible.map((product) => (
              <ProductCard key={product.id} product={product} onOpen={() => setSelected(product)} />
            ))}
          </ul>
        )}
      </main>

      <section className="history" id="riwayat">
        <h2>Purchase history</h2>
        {history.length === 0 ? (
          <p className="notice mt-4">No purchases have been made on this device yet.</p>
        ) : (
          <>
            <ol className="receipts">
              {history.map((entry) => (
                <li key={entry.paymentId ?? entry.linkId}>
                  <div className="receipt-main">
                    <span className="receipt-name">
                      {entry.name} × {entry.quantity}
                    </span>
                    <time dateTime={entry.at}>{formatTime(entry.at)}</time>
                  </div>
                  <div className="receipt-side">
                    <span className="price">{entry.total}</span>
                    {entry.paymentId === undefined ? (
                      <span className="payment-status pending">Pending payment</span>
                    ) : (
                      <>
                        <span className="payment-status successful">Completed</span>
                        <a
                          href={`/checkout/success/${encodeURIComponent(entry.paymentId)}`}
                          className="payment-reference"
                        >
                          View payment status
                        </a>
                        <code>{entry.paymentId}</code>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            <p className="notice">
              History is stored on this device and finalized after verification.
            </p>
          </>
        )}
      </section>

      <section className="about" id="tentang">
        <div className="gap-y-2 flex-col flex">
          <h2>About</h2>
          <p>
            Parahyangan Supply began at a single printing table in Buah Batu. Every piece is still
            cut, sewn, printed, and packed by neighboring Bandung workshops.
          </p>
        </div>
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
      </section>

      <footer className="colophon">
        <span className="colophon-mark">
          <LogoMark size={28} />
        </span>
        <p>© 2026 Parahyangan Supply, Bandung. Payments powered by Mayarin.</p>
      </footer>

      {selected !== undefined && (
        <ProductDialog
          product={selected}
          onAddToCart={addToCart}
          onClose={() => setSelected(undefined)}
        />
      )}
      <CartDrawer
        lines={cart}
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        onQuantity={(productId, quantity) =>
          setCart((current) =>
            quantity <= 0
              ? current.filter((line) => line.product.id !== productId)
              : current.map((line) =>
                  line.product.id === productId ? { ...line, quantity } : line,
                ),
          )
        }
        onRemove={(productId) =>
          setCart((current) => current.filter((line) => line.product.id !== productId))
        }
      />
    </>
  );
}
