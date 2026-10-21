import type { ComponentChildren } from "preact";
import { useRef } from "preact/hooks";
import { Reveal } from "../reveal.tsx";

/**
 * Why a merchant picks Mayarin: properties of the system rather than
 * features — who holds the money, how much of it you have to adopt, where
 * payers can pay from, whether every movement can be accounted for, whether a
 * crash can lose or double one, and who can pay. Each claim is something the
 * code guarantees today, not a roadmap item.
 *
 * The cards sit in a horizontal scroll-snap row, so more can be added without
 * squeezing the rest.
 */
export function Why() {
  const row = useRef<HTMLDivElement>(null);
  const scroll = (direction: 1 | -1) => {
    const first = row.current?.firstElementChild;
    if (!row.current || !first) return;
    row.current.scrollBy({
      left: direction * (first.getBoundingClientRect().width + 12),
      behavior: "smooth",
    });
  };

  return (
    <section id="why" class="mx-auto w-full max-w-300 px-5 py-20 md:px-10 md:py-28">
      <Reveal>
        <p class="inline-flex rounded-full border border-line px-3 py-1 text-xs text-slate-600">
          Why Mayarin
        </p>
        <h2 class="mt-6 max-w-240 text-balance">
          Built to be trusted with every payment. Merchants choose Mayarin for{" "}
          <span class="text-brand">non-custodial, flexible, multi-chain and auditable</span>{" "}
          stablecoin payments.
        </h2>
      </Reveal>

      <div class="mt-12 flex justify-end gap-2 md:mt-16">
        <ArrowButton label="Previous" onClick={() => scroll(-1)} />
        <ArrowButton label="Next" onClick={() => scroll(1)} />
      </div>

      {/* Claims of about the same length; each description starts at the same
          height under its title, so the row lines up across. */}
      <div
        ref={row}
        class="mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth scrollbar-none [&::-webkit-scrollbar]:hidden"
      >
        <WhyCard
          icon={<WalletIcon />}
          title="Non-custodial"
          body="Settlements land in a wallet you control. Mayarin never holds your customer's funds on the contract path."
        />
        <WhyCard
          icon={<BlocksIcon />}
          title="Flexible"
          delay={90}
          body="Hosted checkout, payment links and invoices, or the API and SDK. Use only the parts your product needs."
        />
        <WhyCard
          icon={<NetworkIcon />}
          title="Multi-chain"
          delay={180}
          body="Payers bring any supported asset on six EVM and Solana networks. You settle in the stablecoin you choose."
        />
        <WhyCard
          icon={<LedgerIcon />}
          title="Auditable"
          delay={270}
          body="Every payment moves through balanced, double-entry postings. No balance ever changes without a trail."
        />
        <WhyCard
          icon={<ShieldIcon />}
          title="Resilient"
          delay={360}
          body="Every step is idempotent and resumable. A retry or a crash mid-payment can't double-post or lose value."
        />
        <WhyCard
          icon={<AgentIcon />}
          title="Agent-ready"
          delay={450}
          body="Software can pay too. An autonomous agent reaches the same clearing and the same merchant as a person."
        />
      </div>
    </section>
  );
}

function WhyCard({
  icon,
  title,
  body,
  delay = 0,
}: {
  readonly icon: ComponentChildren;
  readonly title: string;
  readonly body: string;
  readonly delay?: number;
}) {
  return (
    <Reveal
      delay={delay}
      class="h-full w-[82%] shrink-0 snap-start md:w-[calc(50%-6px)] lg:w-[calc(25%-9px)]"
    >
      <article class="flex h-full flex-col rounded-2xl border border-line bg-paper p-6 md:p-8">
        <span class="text-brand [&>svg]:size-7">{icon}</span>
        <h3 class="mt-4 text-[clamp(1.6rem,2.4vw,2rem)]">{title}</h3>
        <p class="mt-16 text-base leading-relaxed text-slate-600">{body}</p>
      </article>
    </Reveal>
  );
}

function ArrowButton({ label, onClick }: { readonly label: string; readonly onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      class="grid size-10 place-items-center rounded-full border border-line bg-paper text-ink transition-colors hover:border-brand hover:text-brand"
    >
      <svg {...ICON} class="size-5" aria-hidden="true">
        <path d={label === "Next" ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6"} />
      </svg>
    </button>
  );
}

const ICON = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "1.5",
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
} as const;

function WalletIcon() {
  return (
    <svg {...ICON} aria-hidden="true">
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A1.5 1.5 0 0 1 19 6.5V8" />
      <path d="M4 7.5v10A1.5 1.5 0 0 0 5.5 19h13a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 18.5 8h-12A2.5 2.5 0 0 1 4 5.5" />
      <circle cx="16" cy="13.5" r="1" />
    </svg>
  );
}

function BlocksIcon() {
  return (
    <svg {...ICON} aria-hidden="true">
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <path d="M16.5 13.5v6M13.5 16.5h6" />
    </svg>
  );
}

function NetworkIcon() {
  return (
    <svg {...ICON} aria-hidden="true">
      <circle cx="12" cy="5" r="2" />
      <circle cx="5" cy="18" r="2" />
      <circle cx="19" cy="18" r="2" />
      <path d="M12 7v4M12 11l-5.5 5.2M12 11l5.5 5.2" />
    </svg>
  );
}

function LedgerIcon() {
  return (
    <svg {...ICON} aria-hidden="true">
      <path d="M6 4h12v16H6z" />
      <path d="M12 4v16M8.5 8.5h1.5M8.5 12h1.5M14 8.5h1.5M14 12h1.5M8.5 15.5h7" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg {...ICON} aria-hidden="true">
      <path d="M12 4l7 2.5v5c0 4.2-2.8 7.2-7 8.5-4.2-1.3-7-4.3-7-8.5v-5z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function AgentIcon() {
  return (
    <svg {...ICON} aria-hidden="true">
      <rect x="5" y="8" width="14" height="10" rx="2.5" />
      <path d="M12 4v4M9 13h.01M15 13h.01M9.5 16h5" />
    </svg>
  );
}
