import clsx from "clsx";
import { useEffect, useState } from "preact/hooks";
import { Wordmark } from "./logo.tsx";
import { ArrowRight } from "./ui.tsx";

const links = [
  { label: "Platform", href: "#platform" },
  { label: "Architecture", href: "#architecture" },
  { label: "Developers", href: "#developers" },
  { label: "Use cases", href: "#use-cases" },
];

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
          line however wide the wordmark or the CTA get. */}
      <div class="shell grid h-16 grid-cols-[1fr_auto_1fr] items-center md:h-18">
        <div class="flex justify-start">
          <Wordmark />
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
          <a
            href="#start"
            class="btn-fill [--btn-fill:var(--color-forest)] inline-flex h-10 cursor-pointer items-center gap-2 rounded-full bg-ink px-5 text-sm font-medium text-white"
          >
            Try our app
            <ArrowRight />
          </a>
        </div>

        <button
          type="button"
          class="col-start-3 -mr-2 flex size-10 cursor-pointer items-center justify-self-end lg:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((value) => !value)}
        >
          <svg viewBox="0 0 20 20" width="20" height="20" fill="none" aria-hidden="true">
            <path
              d={open ? "M5 5l10 10M15 5L5 15" : "M2 6h16M2 14h16"}
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="square"
            />
          </svg>
        </button>
      </div>

      {open ? (
        <div id="mobile-nav" class="border-t border-line bg-paper lg:hidden">
          <nav aria-label="Primary" class="shell flex flex-col py-4">
            {links.map((link) => (
              <a key={link.href} href={link.href} class="border-b border-line py-4 text-lg">
                {link.label}
              </a>
            ))}
            <a
              href="#start"
              class="btn-fill [--btn-fill:var(--color-forest)] mt-6 mb-2 inline-flex h-12 items-center justify-center gap-2 bg-ink text-sm font-medium text-white"
            >
              Try our app
              <ArrowRight />
            </a>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
