import { FooterWordmark } from "./footer-wordmark.tsx";
import { ScrambleText } from "./scramble-text.tsx";

const COLUMNS = [
  {
    heading: "Platform",
    links: [
      { label: "Clearing Engine", href: "#how-it-works" },
      { label: "Liquidity Routing", href: "#capabilities" },
      { label: "Settlement", href: "#capabilities" },
      { label: "Ledger", href: "#capabilities" },
    ],
  },
  {
    heading: "Developers",
    links: [
      { label: "Documentation", href: "https://docs.mayarin.xyz" },
      { label: "API reference", href: "https://docs.mayarin.xyz" },
      { label: "Architecture", href: "#architecture" },
      // { label: "Status", href: "#top" },
    ],
  },
  {
    heading: "Foundation",
    links: [
      { label: "Use cases", href: "#use-cases" },
      { label: "Principles", href: "#principles" },
      { label: "Brand Kit", href: "/brand-kit" },
    ],
  },
];

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

export function Footer() {
  return (
    <footer class="bg-paper">
      <div class="shell py-16 md:py-20">
        <FooterWordmark />

        <div class="mt-14 grid gap-16 md:mt-20 md:grid-cols-[1.4fr_2fr] md:gap-20">
          <div>
            <p class="max-w-[34ch] text-sm leading-[1.7] text-slate">
              Programmable clearing infrastructure. Move value, not complexity.
            </p>
            <p class="label mt-6 text-slate">/maɪˈjɑːrɪn/ · “My-ar-in”</p>
            <div class="mt-6 flex items-center gap-2">
              <a
                href="https://x.com/mayarinxyz"
                target="_blank"
                rel="noreferrer"
                aria-label="Mayarin on X"
                class="inline-flex size-11 items-center justify-center border border-line text-slate transition-colors duration-200 hover:border-ink hover:bg-ink hover:text-white"
              >
                <XIcon />
              </a>
              <a
                href="https://linkedin.com/company/mayarin"
                target="_blank"
                rel="noreferrer"
                aria-label="Mayarin on LinkedIn"
                class="inline-flex size-11 items-center justify-center border border-line text-slate transition-colors duration-200 hover:border-ink hover:bg-ink hover:text-white"
              >
                <LinkedInIcon />
              </a>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-10 sm:grid-cols-3">
            {COLUMNS.map((column) => (
              <div key={column.heading}>
                <p class="label text-slate">{column.heading}</p>
                <ul class="mt-6 space-y-3.5">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        class="text-sm text-ink transition-colors duration-200 hover:text-forest"
                      >
                        <ScrambleText text={link.label} trigger="a" />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div class="mt-20 flex flex-col gap-4 border-t border-line pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p class="text-xs text-slate">
            © {new Date().getFullYear()} Mayarin. All rights reserved.
          </p>
          <p class="label text-slate leading-5">Money moves · Infrastructure orchestrates</p>
        </div>
      </div>
    </footer>
  );
}
