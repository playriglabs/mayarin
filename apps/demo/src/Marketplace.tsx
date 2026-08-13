import { useEffect, useMemo, useState } from "react";
import { HeroArt, LogoLockup, LogoMark } from "./brand.tsx";
import { formatTime, loadHistory, type PurchaseEntry } from "./history.ts";
import { ProductCard } from "./ProductCard.tsx";
import { ProductDialog } from "./ProductDialog.tsx";
import type { DemoProduct } from "./types.ts";

type CatalogState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly products: readonly DemoProduct[] };

const SKELETON_SLOTS = ["s1", "s2", "s3", "s4", "s5", "s6"] as const;
const ALL = "Semua";

export function Marketplace() {
  const [catalog, setCatalog] = useState<CatalogState>({ status: "loading" });
  const [category, setCategory] = useState<string>(ALL);
  const [selected, setSelected] = useState<DemoProduct | undefined>(undefined);
  const [history, setHistory] = useState<readonly PurchaseEntry[]>([]);

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
                ? `Katalog tidak bisa dimuat. ${error.message}`
                : "Katalog tidak bisa dimuat.",
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

  return (
    <>
      <header className="masthead">
        <a href="#atas" className="brand-link" aria-label="Parahyangan Supply">
          <LogoLockup />
        </a>
        <nav aria-label="Utama">
          <a href="#koleksi">Koleksi</a>
          <a href="#riwayat">Riwayat</a>
          <a href="#tentang">Tentang</a>
        </nav>
      </header>

      <section className="hero" id="atas">
        <div className="hero-copy">
          <p className="kicker">Distro · Bandung</p>
          <h1>
            Rilisan kecil,
            <br />
            <em>dijahit di Bandung.</em>
          </h1>
          <p className="lede">
            Tiap artikel dinamai dari jalan tempat kami mengerjakannya. Produksi tetap di kota:
            potong, jahit, sablon. Sekali rilisan habis, tidak dicetak ulang.
          </p>
          <a className="cta" href="#koleksi">
            Belanja koleksi
          </a>
        </div>
        <HeroArt />
      </section>

      <main className="shop" id="koleksi">
        <div className="shop-head">
          <h2>Koleksi</h2>
          {catalog.status === "ready" && (
            <fieldset className="filters">
              <legend className="visually-hidden">Filter kategori</legend>
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
          <p className="notice">Belum ada produk di kategori ini.</p>
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
        <h2>Riwayat</h2>
        {history.length === 0 ? (
          <p className="notice">Belum ada transaksi di perangkat ini.</p>
        ) : (
          <>
            <ol className="receipts">
              {history.map((entry) => (
                <li key={entry.linkId}>
                  <div className="receipt-main">
                    <span className="receipt-name">
                      {entry.name} × {entry.quantity}
                    </span>
                    <time dateTime={entry.at}>{formatTime(entry.at)}</time>
                  </div>
                  <div className="receipt-side">
                    <span className="price">{entry.total}</span>
                    <a href={entry.url}>Halaman pembayaran</a>
                  </div>
                </li>
              ))}
            </ol>
            <p className="notice">
              Riwayat tersimpan di perangkat ini. Status akhir tiap transaksi ada di halaman
              pembayarannya.
            </p>
          </>
        )}
      </section>

      <section className="about" id="tentang">
        <div>
          <h2>Tentang</h2>
          <p>
            Parahyangan Supply mulai dari satu meja sablon di Buah Batu. Produksi tidak pernah
            pindah: potong, jahit, dan kemas masih dikerjakan konveksi tetangga sendiri.
          </p>
          <p>
            Nama tiap rilisan diambil dari jalan tempat prosesnya terjadi. Jumlahnya kecil dan tidak
            diulang.
          </p>
        </div>
        <dl className="facts">
          <div>
            <dt>Toko</dt>
            <dd>Jl. Braga No. 2, Bandung</dd>
          </div>
          <div>
            <dt>Jam buka</dt>
            <dd>Senin–Sabtu, 10.00–21.00 WIB</dd>
          </div>
          <div>
            <dt>Kontak</dt>
            <dd>halo@parahyangansupply.id</dd>
          </div>
        </dl>
      </section>

      <footer className="colophon">
        <span className="colophon-mark">
          <LogoMark size={28} />
        </span>
        <p>© 2026 Parahyangan Supply, Bandung. Pembayaran oleh Mayarin.</p>
      </footer>

      {selected !== undefined && (
        <ProductDialog product={selected} onClose={() => setSelected(undefined)} />
      )}
    </>
  );
}
