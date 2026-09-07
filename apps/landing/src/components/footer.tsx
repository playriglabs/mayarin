import { useEarlyAccess } from "../lib/early-access.ts";
import { FooterWordmark } from "./footer-wordmark.tsx";
import { ScrambleText } from "./scramble-text.tsx";
import { ArrowRight } from "./ui.tsx";

/**
 * Four groups of four. Every link earns its line and lands somewhere real: the
 * three in-page anchors exist on both this landing and the V2 one, and every
 * other destination is a docs page that exists. The dashboard is absent on
 * purpose — the header already carries it.
 */
const COLUMNS = [
  {
    heading: "Platform",
    links: [
      { label: "Clearing engine", href: "#capabilities" },
      { label: "Agent payments", href: "https://docs.mayarin.xyz/guides/x402" },
      { label: "Storefront plugin", href: "https://docs.mayarin.xyz/guides/woocommerce" },
      { label: "Webhooks", href: "https://docs.mayarin.xyz/guides/webhooks" },
    ],
  },
  {
    heading: "Developers",
    links: [
      { label: "Documentation", href: "https://docs.mayarin.xyz" },
      { label: "API reference", href: "https://docs.mayarin.xyz/api-reference" },
      { label: "TypeScript SDK", href: "https://docs.mayarin.xyz/sdk/typescript" },
    ],
  },
  {
    heading: "Concepts",
    links: [
      { label: "Payment lifecycle", href: "https://docs.mayarin.xyz/concepts/payment-lifecycle" },
      { label: "Execution paths", href: "https://docs.mayarin.xyz/concepts/execution-paths" },
      { label: "Money", href: "https://docs.mayarin.xyz/concepts/money" },
      { label: "Error reference", href: "https://docs.mayarin.xyz/errors" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { label: "Use cases", href: "#use-cases" },
      { label: "Principles", href: "#principles" },
      { label: "Brand Kit", href: "/brand-kit/" },
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

/**
 * Early access reduced to one field. The landing section states the offer; here
 * the address is all that is left to give, so the submit collapses into the
 * field rather than being a second control beside it.
 */
function EarlyAccessCapture() {
  const { state, submit, submitting } = useEarlyAccess();

  return (
    <form id="footer-early-access" class="scroll-mt-24" onSubmit={(event) => void submit(event)}>
      <label for="footer-early-access-email" class="text-sm text-slate">
        Get early access
      </label>
      <div class="mt-5 flex h-12 items-center border border-line bg-paper transition-colors duration-200 focus-within:border-forest">
        <input
          id="footer-early-access-email"
          name="email"
          type="email"
          required
          autocomplete="email"
          placeholder="you@company.com"
          disabled={submitting}
          class="h-full min-w-0 flex-1 bg-transparent px-4 text-sm text-ink outline-none placeholder:text-slate disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={submitting}
          aria-label={submitting ? "Joining the early-access list" : "Request early access"}
          class="inline-flex size-12 shrink-0 cursor-pointer items-center justify-center text-ink transition-colors duration-200 hover:text-forest disabled:cursor-not-allowed disabled:opacity-60"
        >
          <ArrowRight />
        </button>
      </div>
      <p
        class={state.status === "error" ? "mt-3 text-xs text-red-700" : "mt-3 text-xs text-forest"}
        aria-live="polite"
      >
        {state.status === "success" || state.status === "error" ? state.message : ""}
      </p>

      <div class="hidden" aria-hidden="true">
        <label for="footer-early-access-company">Company website</label>
        <input
          id="footer-early-access-company"
          name="company"
          type="text"
          tabIndex={-1}
          autocomplete="off"
        />
      </div>
    </form>
  );
}

export function Footer() {
  return (
    <footer class="bg-paper">
      <div class="shell py-12 md:py-16">
        <FooterWordmark />

        <div class="grid gap-12 md:grid-cols-[2fr_1fr] md:gap-14 lg:gap-16">
          <div>
            <div class="grid grid-cols-2 gap-x-8 gap-y-10 lg:grid-cols-4">
              {COLUMNS.map((column) => (
                <div key={column.heading}>
                  <p class="text-[14px] text-slate">{column.heading}</p>
                  <ul class="mt-5 space-y-2">
                    {column.links.map((link) => (
                      <li key={link.label}>
                        <a
                          href={link.href}
                          class="text-[15px] leading-6 font-medium text-ink transition-colors duration-200 hover:text-forest"
                        >
                          <ScrambleText text={link.label} trigger="a" />
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <div class="mt-10">
              <p class="label mt-4 text-slate">/maɪˈjɑːrɪn/ · “My-ar-in”</p>
            </div>
          </div>

          <div>
            <EarlyAccessCapture />

            <div class="mt-8 flex items-center justify-between gap-6 border-t border-line pt-6">
              <p class="text-sm text-slate">Find us on social</p>
              <div class="flex items-center gap-2">
                <a
                  href="https://x.com/mayarinxyz"
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Mayarin on X"
                  class="inline-flex size-10 items-center justify-center border border-line text-slate transition-colors duration-200 hover:border-ink hover:bg-ink hover:text-white"
                >
                  <XIcon />
                </a>
                <a
                  href="https://linkedin.com/company/mayarin"
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Mayarin on LinkedIn"
                  class="inline-flex size-10 items-center justify-center border border-line text-slate transition-colors duration-200 hover:border-ink hover:bg-ink hover:text-white"
                >
                  <LinkedInIcon />
                </a>
              </div>
            </div>
          </div>
        </div>

        <div class="mt-14 flex flex-col gap-4 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p class="text-xs font-medium text-slate">
            © {new Date().getFullYear()} Mayarin. All rights reserved.
          </p>
          <p class="text-slate leading-5 text-sm font-medium">
            Money moves – Infrastructure orchestrates
          </p>
        </div>
      </div>
    </footer>
  );
}
