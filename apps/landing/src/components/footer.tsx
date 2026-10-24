import { useEffect, useRef, useState } from "preact/hooks";
import { gsap, registerGsap } from "../lib/gsap.ts";

const COLUMNS = [
  {
    heading: "Products",
    links: [
      { label: "Hosted checkout", href: "https://docs.mayarin.xyz/sdk/typescript/browser" },
      {
        label: "Payment links",
        href: "https://docs.mayarin.xyz/sdk/typescript/commerce#payment-links",
      },
      { label: "Invoicing", href: "https://docs.mayarin.xyz/sdk/typescript/commerce#invoices" },
      { label: "Subscriptions", href: "https://docs.mayarin.xyz/guides/subscriptions" },
      { label: "Agent payments", href: "https://docs.mayarin.xyz/guides/x402" },
      { label: "WooCommerce", href: "https://docs.mayarin.xyz/guides/woocommerce" },
    ],
  },
  {
    heading: "Platform",
    links: [
      { label: "Why Mayarin", href: "/#benefits" },
      { label: "Payment capabilities", href: "/#capabilities" },
      { label: "Currencies & networks", href: "/#reach" },
      {
        label: "Stablecoin settlement",
        href: "https://docs.mayarin.xyz/concepts/rails#settlement-stablecoins",
      },
      { label: "Use cases", href: "/#use-cases" },
      { label: "Security", href: "/#security" },
    ],
  },
  {
    heading: "Developers",
    links: [
      { label: "Documentation", href: "https://docs.mayarin.xyz" },
      { label: "Quickstart", href: "https://docs.mayarin.xyz/quickstart" },
      { label: "API reference", href: "https://docs.mayarin.xyz/api-reference" },
      { label: "TypeScript SDK", href: "https://docs.mayarin.xyz/sdk/typescript" },
      { label: "Webhooks", href: "https://docs.mayarin.xyz/guides/webhooks" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { label: "Help Center", href: "https://help.mayarin.xyz" },
      { label: "FAQ", href: "/#faq" },
      { label: "Changelog", href: "https://docs.mayarin.xyz/changelog" },
    ],
  },
] as const;

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" class="size-4" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.657l-5.214-6.817-5.967 6.817H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" class="size-5" fill="currentColor">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V8.997h3.414v1.561h.047c.475-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.371 4.267 5.456v6.288ZM5.337 7.433a2.062 2.062 0 1 1 0-4.124 2.062 2.062 0 0 1 0 4.124ZM7.119 20.452H3.555V8.997h3.564v11.455Z" />
    </svg>
  );
}

const STATUS_URL = "https://stats.uptimerobot.com/oTsGTspgSo";

const STATUS_LABEL = {
  operational: "All systems operational",
  issues: "Experiencing issues",
  unknown: "System status",
} as const;

const STATUS_DOT = {
  operational: "bg-emerald-500",
  issues: "bg-amber-500",
  unknown: "bg-slate-400",
} as const;

/** Links to the status page and shows its live state once the check answers. */
function StatusLink() {
  const [state, setState] = useState<keyof typeof STATUS_LABEL>("unknown");

  useEffect(() => {
    fetch("/api/status")
      .then((response) => response.json() as Promise<{ state: keyof typeof STATUS_LABEL }>)
      .then((body) => setState(body.state in STATUS_LABEL ? body.state : "unknown"))
      .catch(() => setState("unknown"));
  }, []);

  return (
    <a
      href={STATUS_URL}
      target="_blank"
      rel="noreferrer"
      class="inline-flex items-center gap-2 text-sm font-medium text-slate-600 transition-colors duration-200 hover:text-brand"
    >
      <span aria-hidden="true" class="relative flex size-2.5">
        {state === "operational" && (
          <span
            class={`absolute inline-flex size-full animate-ping rounded-full opacity-60 motion-reduce:animate-none ${STATUS_DOT[state]}`}
          />
        )}
        <span class={`relative inline-flex size-2.5 rounded-full ${STATUS_DOT[state]}`} />
      </span>
      {STATUS_LABEL[state]}
    </a>
  );
}

const WORDMARK = "mayarin";

/**
 * The name, set huge and cropped at the foot of the page. The letters rise from
 * behind the crop in sequence the first time it scrolls into view; without
 * JavaScript or with reduced motion it simply sits there finished.
 */
function Wordmark() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = root.current;
    if (!node) return;
    registerGsap();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const context = gsap.context(() => {
      gsap.from("[data-letter]", {
        yPercent: 100,
        duration: 1,
        ease: "power4.out",
        stagger: 0.06,
        scrollTrigger: { trigger: node, start: "top 95%", once: true },
      });
    }, node);
    return () => context.revert();
  }, []);

  return (
    <div
      ref={root}
      aria-hidden="true"
      class="mt-12 select-none pb-[max(1rem,env(safe-area-inset-bottom))] [container-type:inline-size] md:mt-16 md:pb-0"
    >
      <p class="h-[0.9em] overflow-hidden text-center text-[31cqw] leading-none font-medium md:h-[0.74em] tracking-[-0.06em] whitespace-nowrap text-ink/20">
        {[...WORDMARK].map((letter, index) => (
          <span
            key={index}
            data-letter
            class="inline-block transition-colors duration-200 hover:text-brand"
          >
            {letter}
          </span>
        ))}
      </p>
    </div>
  );
}

export function Footer() {
  return (
    <footer class="overflow-hidden bg-paper">
      <div class="shell pt-14 md:pt-20">
        <div class="grid gap-12 lg:grid-cols-[1fr_2.4fr] lg:gap-16">
          <div class="flex flex-col items-start">
            <p class="max-w-64 text-[15px] leading-6 text-slate-600">
              Money moves. Infrastructure orchestrates.
            </p>
            <p class="label mt-6 text-slate-600">/maɪˈjɑːrɪn/ · “My-ar-in”</p>

            <div class="mt-8 flex items-center gap-2">
              <a
                href="https://x.com/mayarin_xyz"
                target="_blank"
                rel="noreferrer"
                aria-label="Mayarin on X"
                class="inline-flex size-10 items-center justify-center rounded-full border border-line text-slate-600 transition-colors duration-200 hover:border-ink hover:bg-ink hover:text-white"
              >
                <XIcon />
              </a>
              <a
                href="https://linkedin.com/company/mayarin"
                target="_blank"
                rel="noreferrer"
                aria-label="Mayarin on LinkedIn"
                class="inline-flex size-10 items-center justify-center rounded-full border border-line text-slate-600 transition-colors duration-200 hover:border-ink hover:bg-ink hover:text-white"
              >
                <LinkedInIcon />
              </a>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-x-8 gap-y-10 md:grid-cols-4">
            {COLUMNS.map((column) => (
              <div key={column.heading}>
                <p class="text-[14px] text-slate-600">{column.heading}</p>
                <ul class="mt-5 space-y-2.5">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        class="text-[15px] leading-6 font-medium text-ink transition-colors duration-200 hover:text-brand"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div class="mt-14 flex flex-col-reverse items-center gap-3 border-t border-line pt-6 sm:flex-row sm:justify-between md:mt-20">
          <div class="flex flex-col items-center gap-3 sm:flex-row sm:gap-6">
            <p class="text-xs font-medium text-slate-600">
              © {new Date().getFullYear()} Mayarin. All rights reserved.
            </p>
            <nav aria-label="Legal" class="flex items-center gap-5 text-xs font-medium">
              <a
                href="/privacy"
                class="text-slate-600 transition-colors duration-200 hover:text-brand"
              >
                Privacy Policy
              </a>
              <a
                href="/terms"
                class="text-slate-600 transition-colors duration-200 hover:text-brand"
              >
                Terms of Service
              </a>
            </nav>
          </div>
          <StatusLink />
        </div>

        <Wordmark />
      </div>
    </footer>
  );
}
