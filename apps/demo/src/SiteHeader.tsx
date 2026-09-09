import { LogoLockup } from "./brand.tsx";

/**
 * The sticky masthead, shared by every page: the brand, the three nav links
 * (with the current page marked), and the cart trigger.
 */

function CartIcon() {
  return (
    <svg
      className="cart-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 7V6a6 6 0 0 1 12 0v1" />
      <path d="M4 7h16l-1.2 13H5.2L4 7z" />
    </svg>
  );
}

export function SiteHeader({
  pathname,
  cartCount,
  onOpenCart,
}: {
  readonly pathname: string;
  readonly cartCount: number;
  readonly onOpenCart: () => void;
}) {
  const home = pathname === "/";
  const history = pathname === "/history";

  return (
    <>
      <p className="announce">
        Demo store — orders do not ship. Payments run on the Mayarin testnet.
      </p>
      <header className="masthead">
        <a href="/" className="brand-link" aria-label="Parahyangan Supply">
          <LogoLockup />
        </a>
        <nav aria-label="Primary" className="site-nav">
          <a
            href="/#koleksi"
            className={home ? "active" : undefined}
            aria-current={home ? "page" : undefined}
          >
            Collection
          </a>
          <a
            href="/history"
            className={history ? "active" : undefined}
            aria-current={history ? "page" : undefined}
          >
            History
          </a>
          <a
            href="/#tentang"
            className={home ? "active" : undefined}
            aria-current={home ? "page" : undefined}
          >
            About
          </a>
        </nav>
        <button
          type="button"
          className="cart-trigger"
          aria-label={`Cart, ${cartCount} ${cartCount === 1 ? "item" : "items"}`}
          onClick={onOpenCart}
        >
          <CartIcon />
          Cart <span aria-hidden="true">{cartCount}</span>
        </button>
      </header>
    </>
  );
}
