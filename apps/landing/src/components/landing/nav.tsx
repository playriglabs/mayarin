import clsx from "clsx";
import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { BOOK_DEMO_URL } from "../../lib/book-demo.ts";
import { GetStartedDialog } from "./get-started-dialog.tsx";

const HELP_URL = "https://help.mayarin.xyz";

/** The sandbox stays on testnet for good. */
const SANDBOX_URL = "https://dashboard-testnet.mayarin.xyz/login";

interface MenuItem {
  readonly label: string;
  readonly description: string;
  readonly href: string;
  readonly icon: JSX.Element;
  /** Opens in a new tab and shows the arrow; in-page anchors do neither. */
  readonly external?: true;
}

const PRODUCT_LINKS: readonly MenuItem[] = [
  {
    label: "Capabilities",
    description: "Pricing, clearing and settlement in one layer.",
    href: "#capabilities",
    icon: <CapabilitiesIcon />,
  },
  {
    label: "Use cases",
    description: "How merchants, apps and agents get paid.",
    href: "#use-cases",
    icon: <UseCasesIcon />,
  },
];

/** Every destination is a real docs page; nothing here is a placeholder. */
const DEVELOPER_LINKS: readonly MenuItem[] = [
  {
    label: "Documentation",
    description: "Quickstart, guides and concepts.",
    href: "https://docs.mayarin.xyz",
    icon: <DocsIcon />,
    external: true,
  },
  {
    label: "API reference",
    description: "Every endpoint and request shape.",
    href: "https://docs.mayarin.xyz/api-reference",
    icon: <ApiIcon />,
    external: true,
  },
  {
    label: "TypeScript SDK",
    description: "Build with the typed client.",
    href: "https://docs.mayarin.xyz/sdk/typescript",
    icon: <SdkIcon />,
    external: true,
  },
];

function CapabilitiesIcon() {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      stroke-width="1.25"
      stroke-linecap="square"
      aria-hidden="true"
    >
      <path d="M5 5h9v9H5zM18 5h9v9h-9zM5 18h9v9H5zM18 18h9v9h-9z" />
    </svg>
  );
}

function UseCasesIcon() {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      stroke-width="1.25"
      stroke-linecap="square"
      aria-hidden="true"
    >
      <path d="m16 5 11 6-11 6-11-6zM5 17l11 6 11-6M5 22l11 6 11-6" />
    </svg>
  );
}

function DocsIcon() {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      stroke-width="1.25"
      stroke-linecap="square"
      aria-hidden="true"
    >
      <path d="M6 5h13l7 7v15H6zM19 5v7h7M10 17h12M10 22h8" />
    </svg>
  );
}

function ApiIcon() {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      stroke-width="1.25"
      stroke-linecap="square"
      aria-hidden="true"
    >
      <path d="M3 16h6M23 16h6" />
      <rect x="9" y="9" width="14" height="14" />
      <path d="M16 3v6M16 23v6" />
    </svg>
  );
}

function SdkIcon() {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      stroke-width="1.25"
      stroke-linecap="square"
      aria-hidden="true"
    >
      <path d="M5 7h22v18H5zM5 13h22M10 17l-2 2 2 2M14 21h5" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function ChevronDown({ open }: { readonly open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      aria-hidden="true"
      class={clsx("size-4 transition-transform duration-200", { "rotate-180": open })}
    >
      <path d="m3.5 6 4.5 4 4.5-4" stroke-linecap="square" />
    </svg>
  );
}

function ExternalArrow() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.25"
      aria-hidden="true"
      class="size-3 text-slate-600/60"
    >
      <path d="M4 12 12 4M6 4h6v6" stroke-linecap="square" />
    </svg>
  );
}

type MenuId = "products" | "developers";

function DesktopMenu({
  id,
  label,
  items,
  open,
  onToggle,
  onClose,
}: {
  readonly id: MenuId;
  readonly label: string;
  readonly items: readonly MenuItem[];
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onClose: () => void;
}) {
  return (
    <div class="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`v2-${id}-menu`}
        onClick={onToggle}
        class="inline-flex cursor-pointer items-center gap-1.5 transition-colors hover:text-brand"
      >
        {label}
        <ChevronDown open={open} />
      </button>

      <div
        id={`v2-${id}-menu`}
        aria-hidden={!open}
        inert={!open}
        class={clsx(
          "absolute top-full left-1/2 mt-5 w-96 -translate-x-1/2 rounded-2xl border border-line bg-paper p-3 shadow-[0_20px_60px_#1111111f] transition-[opacity,transform,visibility] duration-200",
          open ? "visible translate-y-0 opacity-100" : "invisible -translate-y-2 opacity-0",
        )}
      >
        <p class="px-3 pt-2 pb-3 text-slate-600">{label}</p>
        <div class="grid gap-1">
          {items.map((item) => (
            <a
              key={item.href}
              href={item.href}
              {...(item.external ? { target: "_blank", rel: "noreferrer" } : {})}
              onClick={onClose}
              class="group flex items-center gap-4 rounded-xl p-3 transition-colors hover:bg-v2-mist"
            >
              <span class="flex size-10 shrink-0 items-center justify-center rounded-lg border border-line text-slate-600 transition-colors group-hover:border-ink group-hover:text-ink [&>svg]:size-6">
                {item.icon}
              </span>
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-2 text-sm font-medium text-ink">
                  {item.label}
                  {item.external && <ExternalArrow />}
                </span>
                <span class="mt-0.5 block text-xs leading-5 text-slate-600">
                  {item.description}
                </span>
              </span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

/** One top-level row of the mobile sheet; a fixed height keeps every row the same. */
const MOBILE_ROW =
  "flex min-h-12 w-full cursor-pointer items-center justify-between text-left transition-colors hover:text-brand";

function MobileMenu({
  id,
  label,
  items,
  open,
  onToggle,
  onClose,
}: {
  readonly id: MenuId;
  readonly label: string;
  readonly items: readonly MenuItem[];
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onClose: () => void;
}) {
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`v2-${id}-menu-mobile`}
        onClick={onToggle}
        class={MOBILE_ROW}
      >
        {label}
        <ChevronDown open={open} />
      </button>
      <div
        id={`v2-${id}-menu-mobile`}
        aria-hidden={!open}
        inert={!open}
        class={clsx(
          "grid overflow-hidden transition-[grid-template-rows,opacity] duration-200",
          open ? "grid-rows-[1fr] pb-2 opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div class="min-h-0">
          {items.map((item) => (
            <a
              key={item.href}
              href={item.href}
              {...(item.external ? { target: "_blank", rel: "noreferrer" } : {})}
              onClick={onClose}
              class="flex items-center gap-3 py-3 pl-4 text-sm text-slate-600 transition-colors hover:text-ink"
            >
              <span class="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line [&>svg]:size-5">
                {item.icon}
              </span>
              <span class="flex flex-1 items-center justify-between gap-3">
                {item.label}
                {item.external && <ExternalArrow />}
              </span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Navigation() {
  const [open, setOpen] = useState(false);
  const [getStarted, setGetStarted] = useState(false);
  const [menu, setMenu] = useState<MenuId | null>(null);
  const toggleMenu = (id: MenuId) => setMenu(menu === id ? null : id);
  const toggle = useRef<HTMLButtonElement>(null);
  const desktopMenu = useRef<HTMLDivElement>(null);
  const mobileMenu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (menu === null) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (desktopMenu.current?.contains(target) || mobileMenu.current?.contains(target)) return;
      setMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menu]);

  // In-page anchors close the sheet themselves, so the links stay plain anchors.
  useEffect(() => {
    const close = () => {
      setOpen(false);
      setMenu(null);
    };
    window.addEventListener("hashchange", close);
    return () => window.removeEventListener("hashchange", close);
  }, []);

  return (
    <header class="fixed inset-x-0 top-0 z-50 border-b border-line bg-paper">
      <div class="mx-auto flex h-16 w-full max-w-300 items-center gap-10 px-6 md:px-10">
        <a
          class="flex shrink-0 items-center text-[30px] leading-none tracking-[-0.06em] font-(--font-brand)"
          href="#top"
          aria-label="Mayarin home"
        >
          <span class="font-medium font-sans -ml-1 text-[1.7rem] md:text-[1.8rem]">mayarin</span>
        </a>

        {/* Beside the wordmark rather than centred: the bar reads left to right,
            so the sections sit next to the name they belong to. */}
        <nav
          class="ml-10 hidden items-center gap-8 mt-px text-sm xl:flex"
          aria-label="Main navigation"
        >
          <div ref={desktopMenu} class="flex items-center gap-8">
            <DesktopMenu
              id="products"
              label="Products"
              items={PRODUCT_LINKS}
              open={menu === "products"}
              onToggle={() => toggleMenu("products")}
              onClose={() => setMenu(null)}
            />
            <DesktopMenu
              id="developers"
              label="Developers"
              items={DEVELOPER_LINKS}
              open={menu === "developers"}
              onToggle={() => toggleMenu("developers")}
              onClose={() => setMenu(null)}
            />
          </div>

          <a href={HELP_URL} class="transition-colors hover:text-brand">
            Help Center
          </a>

          <a href={SANDBOX_URL} class="transition-colors hover:text-brand">
            Sandbox
          </a>
        </nav>

        <div class="ml-auto hidden items-center gap-6 text-sm xl:flex mt-px">
          <button
            type="button"
            class="cursor-pointer transition-colors hover:text-brand"
            onClick={() => setGetStarted(true)}
          >
            Get started
          </button>
          <a
            href={BOOK_DEMO_URL}
            class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-5 py-2.5 leading-5 ring-1 ring-inset ring-line transition-colors duration-200 hover:bg-ink hover:text-paper hover:ring-ink"
          >
            Book demo
            <Chevron />
          </a>
        </div>

        <button
          ref={toggle}
          type="button"
          class="ml-auto flex size-11 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-v2-mist xl:hidden"
          aria-expanded={open}
          aria-controls="v2-mobile-menu"
          aria-label={open ? "Close navigation" : "Open navigation"}
          onClick={() => setOpen(!open)}
        >
          <span aria-hidden="true" class="relative block size-5">
            <span
              class={clsx(
                "absolute top-1/2 left-1/2 block h-px w-5 -translate-x-1/2 bg-current transition-transform duration-300 ease-out motion-reduce:transition-none",
                open ? "-translate-y-1/2 rotate-45" : "-translate-y-1",
              )}
            />
            <span
              class={clsx(
                "absolute top-1/2 left-1/2 block h-px w-5 -translate-x-1/2 bg-current transition-transform duration-300 ease-out motion-reduce:transition-none",
                open ? "-translate-y-1/2 -rotate-45" : "translate-y-1",
              )}
            />
          </span>
        </button>
      </div>

      {/* Dims the page under the sheet. Positioned, and before the sheet in the
          DOM, so the sheet paints over it; a `fixed` element would otherwise sit
          above the static nav whatever the source order. */}
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close navigation"
        onClick={() => setOpen(false)}
        class={clsx(
          "fixed inset-0 top-16 cursor-default bg-ink/40 backdrop-blur-sm transition-[opacity,visibility] duration-300 ease-out motion-reduce:transition-none xl:hidden",
          open ? "visible opacity-100" : "invisible opacity-0",
        )}
      />

      <div
        class={clsx(
          "relative grid overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none xl:hidden",
          open ? "grid-rows-[1fr] border-t border-line opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div class="min-h-0">
          <nav
            id="v2-mobile-menu"
            inert={!open}
            class={clsx(
              "bg-paper px-6 py-3 transition-transform duration-300 ease-out motion-reduce:transition-none",
              open ? "translate-y-0" : "-translate-y-3",
            )}
            aria-label="Mobile navigation"
          >
            <div ref={mobileMenu}>
              <MobileMenu
                id="products"
                label="Products"
                items={PRODUCT_LINKS}
                open={menu === "products"}
                onToggle={() => toggleMenu("products")}
                onClose={() => {
                  setMenu(null);
                  setOpen(false);
                }}
              />
              <MobileMenu
                id="developers"
                label="Developers"
                items={DEVELOPER_LINKS}
                open={menu === "developers"}
                onToggle={() => toggleMenu("developers")}
                onClose={() => {
                  setMenu(null);
                  setOpen(false);
                }}
              />
            </div>

            <a href={HELP_URL} class={MOBILE_ROW}>
              Help Center
            </a>
            <a href={SANDBOX_URL} class={MOBILE_ROW}>
              Sandbox
            </a>
            <button
              type="button"
              class={MOBILE_ROW}
              onClick={() => {
                setOpen(false);
                setGetStarted(true);
              }}
            >
              Get started
            </button>
            <a href={BOOK_DEMO_URL} onClick={() => setOpen(false)} class={MOBILE_ROW}>
              Book demo
            </a>
          </nav>
        </div>
      </div>
      <GetStartedDialog open={getStarted} onClose={() => setGetStarted(false)} />
    </header>
  );
}
