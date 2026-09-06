import { Reveal } from "../components/reveal.tsx";
import { Label, Section, SectionHeading } from "../components/ui.tsx";

type UseCaseGlyph =
  | "storefront"
  | "route"
  | "wallet"
  | "coin"
  | "bag"
  | "globe"
  | "spark"
  | "invoice"
  | "endpoint"
  | "agent"
  | "terminal"
  | "plugin";

const USE_CASES = [
  {
    icon: "storefront" as const,
    title: "Merchant platforms",
    body: "Price in local currency, settle in a stablecoin — customers pay any supported crypto.",
  },
  {
    icon: "route" as const,
    title: "Payment processors",
    body: "Add digital-asset acceptance behind an existing processing stack without rebuilding settlement.",
  },
  {
    icon: "endpoint" as const,
    title: "API & data providers",
    body: "Price one endpoint and let it collect per call. No key to issue, no plan to meter, no invoice.",
  },
  {
    icon: "agent" as const,
    title: "Autonomous agents",
    body: "An agent signs one authorization for an exact amount. It never registers, holds gas or sees an address.",
  },
  {
    icon: "coin" as const,
    title: "Stablecoin platforms",
    body: "Give issued value somewhere to go: merchant payouts, treasury movements, on-chain settlement.",
  },
  {
    icon: "globe" as const,
    title: "Cross-border commerce",
    body: "Route across assets and chains per payment, priced at lock time, settled in the merchant's stablecoin.",
  },
  {
    icon: "invoice" as const,
    title: "Freelancers & agencies",
    body: "Issue a numbered invoice with your own reference, collect across borders and reconcile every payment.",
  },
  {
    icon: "terminal" as const,
    title: "In-person counters",
    body: "A static merchant QR or a per-payment code: the same intents a server creates, at a till.",
  },
  {
    icon: "wallet" as const,
    title: "Wallets",
    body: "Turn a balance into a payment at any merchant, with clearing handled off the client.",
  },
  {
    icon: "plugin" as const,
    title: "Storefront plugins",
    body: "Drop crypto acceptance into an existing shop — signed webhooks verify the order, not a callback's word.",
  },
  {
    icon: "bag" as const,
    title: "Marketplaces",
    body: "Split, hold and release funds against a ledger that reconciles itself by construction.",
  },
  {
    icon: "spark" as const,
    title: "Content creators",
    body: "Share a payment link for tips, commissions or digital work priced locally and paid by assets.",
  },
] as const;

function UseCaseIcon({ name }: { name: UseCaseGlyph }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    "stroke-width": 1.25,
    "stroke-linecap": "square" as const,
    "stroke-linejoin": "miter" as const,
  };

  switch (name) {
    case "storefront":
      return (
        <>
          <path
            {...common}
            d="M4 10.5h16M5.5 10.5V20h13v-9.5M3 10.5l1.8-6h14.4l1.8 6M8 14h3v6H8z"
          />
          <path
            {...common}
            d="M3 10.5c.5 1.3 1.5 2 3 2s2.5-.7 3-2c.5 1.3 1.5 2 3 2s2.5-.7 3-2c.5 1.3 1.5 2 3 2s2.5-.7 3-2"
          />
        </>
      );
    case "route":
      return (
        <>
          <circle {...common} cx="5" cy="5" r="2" />
          <circle {...common} cx="19" cy="19" r="2" />
          <path
            {...common}
            d="M7 5h5a4 4 0 0 1 4 4v2a4 4 0 0 0 4 4h0M17 19h-5a4 4 0 0 1-4-4v-2a4 4 0 0 0-4-4h0"
          />
        </>
      );
    case "wallet":
      return (
        <>
          <path
            {...common}
            d="M4 7.5h15a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v1.5"
          />
          <path {...common} d="M20 11h-5a2 2 0 0 0 0 4h5M15 13h.01" />
        </>
      );
    case "coin":
      return (
        <>
          <path {...common} d="M13.744 17.736a6 6 0 1 1-7.48-7.48" />
          <path {...common} d="M15 6h1v4M6.134 14.768l.866-.5 2 3.464" />
          <circle {...common} cx="16" cy="8" r="6" />
        </>
      );
    case "bag":
      return (
        <>
          <path {...common} d="M6 8h12l1 13H5z" />
          <path {...common} d="M9 8V5h6v3" />
        </>
      );
    case "globe":
      return (
        <>
          <circle {...common} cx="12" cy="12" r="8" />
          <path
            {...common}
            d="M4.5 9h15M4.5 15h15M12 4c2 2.1 3 4.8 3 8s-1 5.9-3 8c-2-2.1-3-4.8-3-8s1-5.9 3-8z"
          />
        </>
      );
    case "spark":
      return (
        <>
          <path
            {...common}
            d="M12 3v5M12 16v5M3 12h5M16 12h5M5.6 5.6l3.5 3.5M14.9 14.9l3.5 3.5M18.4 5.6l-3.5 3.5M9.1 14.9l-3.5 3.5"
          />
          <circle {...common} cx="12" cy="12" r="2.5" />
        </>
      );
    case "invoice":
      return (
        <>
          <path {...common} d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
          <path {...common} d="M9 8h6M9 12h6M9 16h3" />
        </>
      );
    case "endpoint":
      return (
        <>
          <path {...common} d="M2 12h6M16 12h6" />
          <rect {...common} x="8" y="8" width="8" height="8" />
          <path {...common} d="M12 3v5M12 16v5" />
        </>
      );
    case "agent":
      return (
        <>
          <rect {...common} x="3" y="7" width="18" height="13" />
          <path {...common} d="M12 3v4M8 12h.01M16 12h.01M9 16h6" />
        </>
      );
    case "terminal":
      return (
        <>
          <rect {...common} x="4" y="9" width="16" height="12" />
          <path {...common} d="M7 9V4h10v5M9 14h6" />
        </>
      );
    case "plugin":
      return (
        <>
          <path {...common} d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0z" />
          <path {...common} d="M12 17v4" />
        </>
      );
  }
}

export function UseCases() {
  return (
    <Section id="use-cases">
      <Reveal>
        <Label>Use cases</Label>
      </Reveal>

      <Reveal delay={60}>
        <SectionHeading>Wherever value has to cross a boundary.</SectionHeading>
      </Reveal>

      <div class="ornament-grid mt-12 grid grid-cols-1 border-l border-t sm:grid-cols-2 xl:grid-cols-4 md:mt-16">
        {USE_CASES.map((useCase, index) => (
          <Reveal
            key={useCase.title}
            delay={(index % 2) * 80}
            class="ornament-card group relative flex min-h-72 flex-col border-b border-r p-6 transition-colors duration-300 hover:bg-[#fafafa] md:p-7 xl:p-8"
          >
            <div class="flex items-start justify-between">
              <span class="label text-slate">{String(index + 1).padStart(2, "0")}</span>
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                class="size-8 text-forest transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-1"
              >
                <UseCaseIcon name={useCase.icon} />
              </svg>
            </div>
            <h4 class="mt-auto pt-12 font-display text-[clamp(1.8rem,2.5vw,2.2rem)] leading-none">
              {useCase.title}
            </h4>
            <p class="mt-5 max-w-[32ch] text-[0.9375rem] leading-[1.65] text-slate">
              {useCase.body}
            </p>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
