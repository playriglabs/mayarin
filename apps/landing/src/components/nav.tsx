import clsx from "clsx";
import { useEffect, useState } from "preact/hooks";
import { Logo } from "./logo.tsx";
import { ArrowRight } from "./ui.tsx";

const links = [
  { label: "Platform", href: "#platform" },
  { label: "Architecture", href: "#architecture" },
  { label: "Developers", href: "#developers" },
  { label: "Use cases", href: "#use-cases" },
];

const DASHBOARD_URL = "https://dashboard-testnet.mayarin.xyz/login";

export function Nav() {
  const [lifted, setLifted] = useState(false);
  const [open, setOpen] = useState(false);

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

  // The sheet closes on navigation itself, so the links stay plain anchors.
  useEffect(() => {
    const close = () => setOpen(false);
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

        <nav aria-label="Primary" class="hidden items-center gap-8 lg:flex">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              class="text-sm text-slate transition-colors duration-200 hover:text-forest"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div class="hidden justify-end lg:flex">
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
          class="col-start-3 -mr-2 flex size-10 cursor-pointer items-center justify-center justify-self-end lg:hidden"
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
          "grid bg-paper transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none lg:hidden",
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
            {links.map((link) => (
              <a key={link.href} href={link.href} class="border-b border-line py-4 text-lg">
                {link.label}
              </a>
            ))}
            <a
              href="#early-access"
              class="mobile-nav-demo btn-fill [--btn-fill:var(--color-ink)] mt-6 inline-flex h-12 items-center justify-center border border-ink bg-transparent px-5 text-sm font-medium text-ink transition-colors duration-200"
            >
              Request demo
            </a>
            <a
              href={DASHBOARD_URL}
              class="btn-fill [--btn-fill:var(--color-forest)] mt-2 mb-2 inline-flex h-12 items-center justify-center gap-2 bg-ink text-sm font-medium text-white"
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
