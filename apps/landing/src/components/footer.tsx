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
      { label: "Documentation", href: "#developers" },
      { label: "API reference", href: "#developers" },
      { label: "Architecture", href: "#architecture" },
      { label: "Status", href: "#top" },
    ],
  },
  {
    heading: "Foundation",
    links: [
      { label: "Use cases", href: "#use-cases" },
      { label: "Principles", href: "#principles" },
      { label: "Contact", href: "#start" },
      { label: "Pitchdeck", href: "/pitch-deck" },
    ],
  },
];

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
          <p class="label text-slate">Money moves · Infrastructure orchestrates</p>
        </div>
      </div>
    </footer>
  );
}
