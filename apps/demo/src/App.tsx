import { useEffect, useMemo, useState } from "react";
import { CartDrawer, type CartLine } from "./CartDrawer.tsx";
import { loadCart, type StoredCartLine, saveCart } from "./cart-storage.ts";
import { type CheckoutDraftLine, saveDraft } from "./checkout-draft.ts";
import { HistoryPage } from "./HistoryPage.tsx";
import { Marketplace } from "./Marketplace.tsx";
import { PaymentSuccess } from "./PaymentSuccess.tsx";
import { navigate, useLocation } from "./route.ts";
import { ShippingPage } from "./ShippingPage.tsx";
import { SiteHeader } from "./SiteHeader.tsx";
import type { CatalogState, DemoProduct } from "./types.ts";

/**
 * The app shell: it owns the route, the catalog fetch, and the cart — the
 * pieces every page shares — and renders the page the path names. The
 * success route is a full-bleed page of its own and skips the masthead.
 */
export function App() {
  const location = useLocation();
  const [catalog, setCatalog] = useState<CatalogState>({ status: "loading" });
  const [cart, setCart] = useState<readonly StoredCartLine[]>(loadCart);
  const [cartOpen, setCartOpen] = useState(false);

  useEffect(() => {
    saveCart(cart);
  }, [cart]);

  useEffect(() => {
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
  /** The stored ids joined against the catalog; a product that is gone drops out. */
  const cartLines: readonly CartLine[] = useMemo(
    () =>
      cart.flatMap((line) => {
        const product = products.find((p) => p.id === line.productId);
        return product === undefined ? [] : [{ product, quantity: line.quantity }];
      }),
    [cart, products],
  );
  const cartCount = cartLines.reduce((sum, line) => sum + line.quantity, 0);

  /** Both checkout entry points converge here: park the lines as a draft, go to shipping. */
  const startCheckout = (source: "cart" | "buy_now", items: readonly CheckoutDraftLine[]) => {
    saveDraft({ source, items });
    setCartOpen(false);
    navigate("/checkout/shipping");
  };

  const addToCart = (product: DemoProduct, quantity: number) => {
    setCart((current) => {
      const existing = current.find((line) => line.productId === product.id);
      return existing === undefined
        ? [...current, { productId: product.id, quantity }]
        : current.map((line) =>
            line.productId === product.id
              ? { ...line, quantity: Math.min(9, line.quantity + quantity) }
              : line,
          );
    });
    setCartOpen(true);
  };

  const [pathname = "/", query = ""] = location.split("?");
  const successMatch = /^\/checkout\/success\/([^/]+)$/.exec(pathname);

  if (successMatch !== null) {
    return <PaymentSuccess referencePaymentId={decodeURIComponent(successMatch[1] ?? "")} />;
  }

  const highlight = pathname === "/history" ? new URLSearchParams(query).get("new") : null;

  const page =
    pathname === "/history" ? (
      <HistoryPage highlight={highlight} />
    ) : pathname === "/checkout/shipping" ? (
      <ShippingPage catalog={catalog} onCartCleared={() => setCart([])} />
    ) : (
      <Marketplace
        catalog={catalog}
        addToCart={addToCart}
        onBuyNow={(product, quantity) =>
          startCheckout("buy_now", [{ productId: product.id, quantity }])
        }
      />
    );

  return (
    <>
      <SiteHeader pathname={pathname} cartCount={cartCount} onOpenCart={() => setCartOpen(true)} />
      {page}
      <CartDrawer
        lines={cartLines}
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        onQuantity={(productId, quantity) =>
          setCart((current) =>
            quantity <= 0
              ? current.filter((line) => line.productId !== productId)
              : current.map((line) =>
                  line.productId === productId ? { ...line, quantity } : line,
                ),
          )
        }
        onRemove={(productId) =>
          setCart((current) => current.filter((line) => line.productId !== productId))
        }
        onCheckout={() =>
          startCheckout(
            "cart",
            cart.map((line) => ({ productId: line.productId, quantity: line.quantity })),
          )
        }
      />
    </>
  );
}
