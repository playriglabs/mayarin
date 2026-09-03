import clsx from "clsx";
import { useEffect, useRef, useState } from "preact/hooks";
import { glyphs } from "../graphics/glyphs.tsx";
import { Logo } from "./logo.tsx";
import { ArrowRight } from "./ui.tsx";

const links = [
  { label: "Platform", href: "#platform" },
  { label: "Agents", href: "#agents" },
  { label: "Architecture", href: "#architecture" },
  { label: "Developers", href: "#developers" },
  { label: "Use cases", href: "#use-cases" },
];

const DASHBOARD_URL = "https://dashboard-testnet.mayarin.xyz/login";

const developerLinks = [
  {
    label: "API Reference",
    description: "Explore every endpoint and request shape.",
    href: "https://docs.mayarin.xyz/api-reference",
    icon: glyphs.api,
    external: true,
  },
  {
    label: "SDK",
    description: "Build with Mayarin's typed TypeScript client.",
    href: "https://docs.mayarin.xyz/sdk/typescript",
    icon: <SdkIcon />,
    external: true,
  },
  {
    label: "Foundation",
    description: "Understand the principles behind the scene.",
    href: "#principles",
    icon: <FoundationIcon />,
    external: false,
  },
] as const;

function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      class={clsx("size-4 transition-transform duration-200", open && "rotate-180")}
      stroke="currentColor"
      stroke-width="1.5"
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
      aria-hidden="true"
      class="size-3 text-black/40"
      stroke="currentColor"
      stroke-width="1.25"
    >
      <path d="M4 12 12 4M6 4h6v6" stroke-linecap="square" />
    </svg>
  );
}

function FoundationIcon() {
  return (
    <svg
      viewBox="0 0 32 32"
      width="32"
      height="32"
      fill="none"
      stroke="currentColor"
      stroke-width="1.25"
      stroke-linecap="square"
      aria-hidden="true"
    >
      <path d="M5 7h22v18H5zM5 13h22M5 19h22M12.3 7v18M19.7 7v18" />
    </svg>
  );
}

function SdkIcon() {
  return (
    <svg
      viewBox="0 0 32 32"
      width="32"
      height="32"
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

export function Nav() {
  const [lifted, setLifted] = useState(false);
  const [open, setOpen] = useState(false);
  const [developersOpen, setDevelopersOpen] = useState(false);
  const developersMenuRef = useRef<HTMLDivElement>(null);
  const mobileDevelopersMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setLifted(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  useEffect(() => {
    if (!developersOpen) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target;
      const insideDesktopMenu =
        target instanceof Node && developersMenuRef.current?.contains(target);
      const insideMobileMenu =
        target instanceof Node && mobileDevelopersMenuRef.current?.contains(target);
      if (target instanceof Node && !insideDesktopMenu && !insideMobileMenu) {
        setDevelopersOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDevelopersOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [developersOpen]);

  // The sheet closes on navigation itself, so the links stay plain anchors.
  useEffect(() => {
    const close = () => {
      setOpen(false);
      setDevelopersOpen(false);
    };
    window.addEventListener("hashchange", close);
    return () => window.removeEventListener("hashchange", close);
  }, []);

  return (
    <header
      class={clsx(
        "fixed inset-x-0 top-0 z-50 transition-colors duration-300",
        lifted || open
          ? "border-b border-line bg-paper/85 backdrop-blur-md"
          : "border-b border-transparent",
      )}
    >
      {/* Three tracks, the outer two equal: the menu stays on the page's centre
          line however wide the Logo or the CTA get. */}
      <div class="shell grid h-16 grid-cols-[1fr_auto_1fr] items-center md:h-18">
        <div class="flex justify-start">
          <Logo />
        </div>

        <nav aria-label="Primary" class="hidden items-center gap-8 xl:flex">
          {links.map((link) =>
            link.label === "Developers" ? (
              <div key={link.href} ref={developersMenuRef} class="relative">
                <button
                  type="button"
                  aria-expanded={developersOpen}
                  aria-controls="developers-menu"
                  class="inline-flex cursor-pointer items-center gap-1.5 text-sm text-black/70 transition-colors duration-200 hover:text-forest"
                  onClick={() => setDevelopersOpen((value) => !value)}
                >
                  {link.label}
                  <ChevronDown open={developersOpen} />
                </button>

                <div
                  id="developers-menu"
                  aria-hidden={!developersOpen}
                  class={clsx(
                    "absolute top-full left-1/2 mt-5 w-104 -translate-x-1/2 origin-top rounded-xs border border-line bg-paper p-3 shadow-[0_20px_60px_rgba(17,17,17,0.12)] transition-[opacity,transform,visibility] duration-200",
                    developersOpen
                      ? "visible translate-y-0 opacity-100"
                      : "invisible -translate-y-2 opacity-0",
                  )}
                >
                  <div class="p-2 pb-3">
                    <p class="label text-slate">Developers</p>
                  </div>
                  <div class="grid gap-1">
                    {developerLinks.map(({ icon, external, ...item }) => (
                      <a
                        key={item.href}
                        href={item.href}
                        {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
                        class="group flex items-center gap-4 rounded-xs p-3 transition-colors duration-200 hover:bg-black/4"
                        onClick={() => setDevelopersOpen(false)}
                      >
                        <span class="flex size-10 shrink-0 items-center justify-center rounded-xs border border-line text-slate transition-colors duration-200 group-hover:border-black/20 group-hover:text-ink [&>svg]:size-7">
                          {icon}
                        </span>
                        <span class="min-w-0 flex-1">
                          <span class="flex items-center gap-2 text-sm font-medium text-ink">
                            {item.label}
                            <ExternalArrow />
                          </span>
                          <span class="mt-0.5 block text-sm leading-6 text-slate">
                            {item.description}
                          </span>
                        </span>
                      </a>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <a
                key={link.href}
                href={link.href}
                class="text-sm text-black/70 transition-colors duration-200 hover:text-forest"
              >
                {link.label}
              </a>
            ),
          )}
        </nav>

        <div class="hidden justify-end xl:flex">
          <div class="flex items-center gap-2.5">
            <a
              href="#early-access"
              class="btn-fill [--btn-fill:var(--color-ink)] inline-flex h-10 cursor-pointer items-center border border-ink bg-transparent px-5 text-sm font-medium text-ink transition-colors duration-200 hover:text-white"
            >
              Request demo
            </a>
            <a
              href={DASHBOARD_URL}
              class="btn-fill [--btn-fill:var(--color-forest)] inline-flex h-10 cursor-pointer items-center gap-2 bg-ink px-5 text-sm font-medium text-white"
            >
              Dashboard
              <ArrowRight />
            </a>
          </div>
        </div>

        <button
          type="button"
          class="col-start-3 -mr-2 flex size-10 cursor-pointer items-center justify-center justify-self-end xl:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((value) => !value)}
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

      <div
        id="mobile-nav"
        aria-hidden={!open}
        inert={!open}
        class={clsx(
          "grid bg-paper transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none xl:hidden",
          open
            ? "grid-rows-[1fr] border-t border-line opacity-100"
            : "pointer-events-none grid-rows-[0fr] opacity-0",
        )}
      >
        <div class="min-h-0 overflow-hidden">
          <nav
            aria-label="Primary"
            class={clsx(
              "shell flex flex-col py-4 transition-transform duration-300 ease-out motion-reduce:transition-none",
              open ? "translate-y-0" : "-translate-y-3",
            )}
          >
            {links.map((link) =>
              link.label === "Developers" ? (
                <div key={link.href} ref={mobileDevelopersMenuRef} class="border-b border-line">
                  <button
                    type="button"
                    aria-expanded={developersOpen}
                    aria-controls="developers-menu-mobile"
                    class="flex w-full cursor-pointer items-center justify-between py-4 text-left text-lg"
                    onClick={() => setDevelopersOpen((value) => !value)}
                  >
                    {link.label}
                    <ChevronDown open={developersOpen} />
                  </button>
                  <div
                    id="developers-menu-mobile"
                    aria-hidden={!developersOpen}
                    class={clsx(
                      "grid overflow-hidden transition-[grid-template-rows,opacity] duration-200 motion-reduce:transition-none",
                      developersOpen
                        ? "grid-rows-[1fr] pb-3 opacity-100"
                        : "grid-rows-[0fr] opacity-0",
                    )}
                  >
                    <div class="min-h-0">
                      {developerLinks.map(({ icon, external, ...item }) => (
                        <a
                          key={item.href}
                          href={item.href}
                          {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
                          class="flex items-center gap-3 py-3 text-base text-slate transition-colors duration-200 hover:text-ink"
                          onClick={() => {
                            setDevelopersOpen(false);
                            setOpen(false);
                          }}
                        >
                          <span class="flex size-9 shrink-0 items-center justify-center rounded-xs border border-line [&>svg]:size-6">
                            {icon}
                          </span>
                          <span class="flex min-w-0 flex-1 items-center justify-between gap-3">
                            {item.label}
                            <ExternalArrow />
                          </span>
                        </a>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <a key={link.href} href={link.href} class="border-b border-line py-4 text-lg">
                  {link.label}
                </a>
              ),
            )}
            <a
              href="#early-access"
              class="mobile-nav-demo btn-fill [--btn-fill:var(--color-ink)] mt-6 inline-flex h-12 items-center justify-center border border-ink bg-transparent px-5 text-sm font-medium text-ink transition-colors duration-200"
            >
              Request demo
            </a>
            <a
              href={DASHBOARD_URL}
              class="btn-fill [--btn-fill:var(--color-accent)] mt-2 mb-2 inline-flex h-12 items-center justify-center gap-2 bg-ink text-sm font-medium text-white"
            >
              Dashboard
              <ArrowRight />
            </a>
          </nav>
        </div>
      </div>
    </header>
  );
}
