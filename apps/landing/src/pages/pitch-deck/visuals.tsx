import clsx from "clsx";
import type { ComponentChildren } from "preact";

/*
 * The visual half of each slide. Every visual is plain markup on the dark
 * ground: hairlines, mono labels, and the accent green. Pieces that should
 * stagger in carry `data-reveal`; the deck shell animates them on entry.
 */

const SETTLEMENT_TX =
  "https://sepolia.basescan.org/tx/0x41a87c05e673ed17b80ef5009813b932db74e095d4cdfca2c5dfdda49bee83c1";
const PAYER_TX =
  "https://sepolia.basescan.org/tx/0xe031f84f710834cbbf1516f0dfad12c543933da7772799795235e93d21b7525e";

function Card({
  index,
  title,
  children,
  class: className = "",
}: {
  index?: string;
  title: string;
  children?: ComponentChildren;
  class?: string;
}) {
  return (
    <div data-reveal class={clsx("flex flex-col gap-3 border border-line p-5 md:p-6", className)}>
      {index ? <span class="label text-ink">{index}</span> : null}
      <h3 class="font-sans text-base font-medium tracking-normal text-ink md:text-lg">{title}</h3>
      {children ? <p class="text-sm leading-relaxed text-ink">{children}</p> : null}
    </div>
  );
}

export function TitleLockup() {
  return (
    <div class="flex h-full flex-col items-start justify-between gap-10">
      <div
        data-reveal
        class="flex items-center text-[clamp(3rem,7vw,5.5rem)] leading-none tracking-[-0.06em] md:-ml-6"
      >
        <img
          src="/brand-kit/mayarin-logo-black.svg"
          alt=""
          aria-hidden="true"
          width="160"
          height="160"
          class="size-[1.4em]"
          decoding="async"
        />
        <span class="-ml-[0.06em] font-sans font-medium">mayarin</span>
      </div>
      <div data-reveal class="flex flex-wrap items-end gap-x-10 gap-y-4">
        <div class="flex flex-col gap-2">
          <span class="label text-ink">Pronounced</span>
          <span class="font-mono text-lg text-ink md:text-2xl">/maɪˈjɑːrɪn/ · “My-ar-in”</span>
        </div>
        <a
          href="https://mayarin.xyz"
          class="font-mono text-sm text-forest hover:text-ink md:text-base"
        >
          mayarin.xyz
        </a>
      </div>
    </div>
  );
}

const TEAM = [
  {
    name: "Rizky",
    role: "R&D and Core Contributor",
    experience: "Ex-Kite",
    image: "/images/teams/rizky.png",
    imageClass: "team-photo-rizky",
    links: [
      { kind: "linkedin", label: "/mrizkyy", href: "https://www.linkedin.com/in/mrizkyy/" },
      { kind: "website", label: "rizzky.xyz", href: "https://rizzky.xyz" },
    ],
  },
  {
    name: "Rizki Citra",
    role: "Core Contributor",
    experience: "Software Engineer · Kolosal AI",
    image: "/images/teams/citra.jpeg",
    imageClass: "",
    links: [
      {
        kind: "linkedin",
        label: "/rimzzlabs",
        href: "https://www.linkedin.com/in/rimzzlabs/",
      },
      { kind: "website", label: "rimzzlabs.com", href: "https://rimzzlabs.com" },
    ],
  },
] as const;

function LinkedInMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      class="size-4 shrink-0 text-forest"
      fill="currentColor"
    >
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V8.997h3.414v1.561h.047c.475-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.371 4.267 5.456v6.288ZM5.337 7.433a2.062 2.062 0 1 1 0-4.124 2.062 2.062 0 0 1 0 4.124ZM7.119 20.452H3.555V8.997h3.564v11.455Z" />
    </svg>
  );
}

function WebsiteMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      class="size-4 shrink-0 text-forest"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a15.3 15.3 0 0 1 0 18M12 3a15.3 15.3 0 0 0 0 18" />
    </svg>
  );
}

export function TeamPortraits() {
  return (
    <div class="grid grid-cols-1 gap-px bg-line sm:grid-cols-2">
      {TEAM.map((member) => (
        <article key={member.name} data-reveal class="min-w-0 bg-paper">
          <div class="aspect-square overflow-hidden bg-paper">
            <img
              src={member.image}
              alt={`${member.name}, ${member.role} at Mayarin`}
              width="800"
              height="800"
              class={clsx("team-photo", member.imageClass)}
              decoding="async"
            />
          </div>
          <div class="flex flex-col gap-1 border-t border-line p-4 md:p-5">
            <span class="font-sans text-lg text-ink md:text-xl">{member.name}</span>
            <span class="font-mono text-xs text-forest md:text-sm">{member.role}</span>
            <span class="text-xs text-ink md:text-sm">{member.experience}</span>
            <nav
              aria-label={`${member.name} profiles`}
              class="mt-3 grid grid-cols-2 gap-px bg-line"
            >
              {member.links.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`${member.name} ${link.label}, opens in a new tab`}
                  class="inline-flex min-h-11 min-w-0 items-center gap-2 bg-paper px-3 font-mono text-[0.7rem] text-ink outline-offset-4 transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-accent md:text-xs"
                >
                  {link.kind === "linkedin" ? <LinkedInMark /> : <WebsiteMark />}
                  <span class="truncate">{link.label}</span>
                </a>
              ))}
            </nav>
          </div>
        </article>
      ))}
    </div>
  );
}

export function TeamAndAsk() {
  return (
    <div class="flex flex-col gap-px bg-line">
      <div class="grid grid-cols-1 gap-px sm:grid-cols-2">
        {TEAM.map((member) => (
          <article
            key={member.name}
            data-reveal
            class="grid min-w-0 grid-cols-[5rem_1fr] items-center gap-4 bg-paper p-4 md:grid-cols-[6rem_1fr] md:p-5"
          >
            <img
              src={member.image}
              alt={`${member.name}, ${member.role} at Mayarin`}
              width="160"
              height="160"
              class={clsx("team-photo aspect-square", member.imageClass)}
              decoding="async"
            />
            <div class="flex min-w-0 flex-col gap-1">
              <span class="font-sans text-lg text-ink md:text-xl">{member.name}</span>
              <span class="font-mono text-xs text-forest md:text-sm">{member.role}</span>
              <span class="text-xs text-ink md:text-sm">{member.experience}</span>
            </div>
          </article>
        ))}
      </div>
      <div data-reveal class="flex flex-col gap-5 bg-paper p-5 md:p-6">
        <div class="flex flex-col gap-2">
          <span class="label text-ink">The outcome</span>
          <p class="font-sans text-2xl leading-tight text-ink md:text-3xl">
            Price locally. Pay globally. Settle predictably.
          </p>
        </div>
        <div class="flex items-center justify-between gap-4 border-t border-line pt-4">
          <span class="label text-ink">Next</span>
          <span class="font-mono text-sm text-forest">Controlled mainnet pilot</span>
        </div>
      </div>
    </div>
  );
}

const SETTLEMENT_PROPERTIES = [
  ["01", "Stable unit", "Merchant chooses the fiat-denominated settlement asset."],
  ["02", "Always on", "Settlement runs beyond banking cutoffs and weekends."],
  ["03", "Programmable", "Routing, policy, and reconciliation become software."],
] as const;

const INSTITUTIONAL_SIGNALS = [
  [
    "Visa",
    "USDC settlement · 2025",
    "https://corporate.visa.com/en/sites/visa-perspectives/newsroom/visa-launches-stablecoin-settlement-in-the-united-states.html",
  ],
  [
    "DBS",
    "Token Services · 2024",
    "https://www.dbs.com/newsroom/DBS_rolls_out_blockchain_powered_banking_for_institutions_with_DBS_Token_Services_marks_new_milestone_in_financial_services",
  ],
  [
    "Singapore",
    "SCS framework · 2023",
    "https://www.sgpc.gov.sg/api/file/getfile/Media%20Release_MAS%20Finalises%20Stablecoin%20Regulatory%20Framework.pdf?path=%2Fsgpcmedia%2Fmedia_releases%2Fmas%2Fpress_release%2FP-20230815-2%2Fattachment%2FMedia+Release_MAS+Finalises+Stablecoin+Regulatory+Framework.pdf",
  ],
  [
    "Open USD (OUSD)",
    "140+ signed up · pre-launch",
    "https://www.onepay.com/newsroom/introducing-open-usd",
  ],
] as const;

export function ProblemBridge() {
  return (
    <div class="flex flex-col gap-px bg-line">
      <div class="bg-paper px-5 pt-5 md:px-6 md:pt-6">
        <p class="label mb-2 text-ink">Settlement thesis</p>
        <ol>
          {SETTLEMENT_PROPERTIES.map(([index, title, detail]) => (
            <li
              key={index}
              data-reveal
              class="grid grid-cols-[2rem_1fr] gap-x-4 border-t border-line py-3 last:border-b"
            >
              <span class="label pt-1 text-forest">{index}</span>
              <div class="flex flex-col gap-1">
                <h3 class="font-sans text-base text-ink md:text-lg">{title}</h3>
                <p class="text-xs leading-relaxed text-ink md:text-sm">{detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
      <div class="bg-paper px-5 py-4 md:px-6 md:py-5">
        <p class="label mb-2 text-ink">Institutional signal · official sources</p>
        <ul class="grid grid-cols-2 gap-x-5">
          {INSTITUTIONAL_SIGNALS.map(([name, signal, href]) => (
            <li key={name} data-reveal class="min-w-0 border-t border-line">
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                aria-label={`Verify ${name}: ${signal}, opens primary source in a new tab`}
                class="group flex min-h-11 items-center justify-between gap-3 py-2.5 outline-offset-4 transition-colors focus-visible:outline-2 focus-visible:outline-accent"
              >
                <span class="min-w-0">
                  <span class="label block text-ink group-hover:text-forest">{name}</span>
                  <span class="mt-1 block font-mono text-[0.7rem] leading-relaxed text-forest md:text-xs">
                    {signal}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  class="shrink-0 text-ink transition-colors group-hover:text-ink"
                >
                  ↗
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function FrictionCards() {
  return (
    <div class="grid grid-cols-2 gap-px bg-line">
      <Card index="Merchant" title="Becomes a treasury desk" class="bg-paper">
        Keys, wallets, swaps, gas, reconciliation.
      </Card>
      <Card index="Customer" title="Holds the wrong token" class="bg-paper">
        Wallets are not built for invoices.
      </Card>
      <Card index="Developer" title="Rebuilds the state machine" class="bg-paper">
        APIs, wallets, DEXs, chains — all fragmented.
      </Card>
      <Card index="Infrastructure" title="Drifts from the chain" class="bg-paper">
        Reorgs, replayed webhooks, accidental custody.
      </Card>
    </div>
  );
}

export function ThreeColumns() {
  return (
    <div class="flex flex-col gap-px bg-line">
      <div class="grid grid-cols-1 gap-px md:grid-cols-3">
        <Card index="Merchant" title="Prices in any local fiat currency" class="bg-paper">
          Chooses the stablecoin they settle in.
        </Card>
        <Card index="Mayarin" title="Quotes, locks, converts, settles, records" class="bg-paper">
          One clearing layer behind every checkout.
        </Card>
        <Card index="Customer" title="Pays supported crypto" class="bg-paper">
          Through a wallet call or a plain transfer.
        </Card>
      </div>
      <div
        data-reveal
        class="flex flex-wrap items-center gap-x-6 gap-y-2 bg-paper px-5 py-4 md:px-6"
      >
        <span class="label text-ink">Not</span>
        {["an exchange", "a custodial wallet", "a bank or fiat rail", "a fiat off-ramp"].map(
          (item) => (
            <span key={item} class="text-sm text-ink">
              {item}
            </span>
          ),
        )}
      </div>
    </div>
  );
}

const FLOW = [
  { label: "Customer transfer", detail: "testnet ETH" },
  { label: "Deposit match", detail: "watcher confirms" },
  { label: "PaymentRouter", detail: "Uniswap · ETH → USDC" },
  { label: "Merchant wallet", detail: "net USDC" },
  { label: "Proof surfaces", detail: "chain · ledger · webhook" },
] as const;

export function FlowDiagram() {
  return (
    <div class="flex h-full flex-col justify-between gap-8">
      <ol class="flex flex-col">
        {FLOW.map((step, index) => (
          <li
            key={step.label}
            data-reveal
            class="flex items-baseline gap-4 border-t border-line py-3 last:border-b md:gap-6"
          >
            <span class="label w-8 shrink-0 text-ink">0{index + 1}</span>
            <span class="font-sans text-base text-ink md:text-lg">{step.label}</span>
            <span class="ml-auto font-mono text-xs text-forest md:text-sm">{step.detail}</span>
          </li>
        ))}
      </ol>
      <div data-reveal class="grid grid-cols-1 gap-px bg-line sm:grid-cols-[1.08fr_0.92fr]">
        {[
          ["Payer\u00a0transfer", "0xe031f8…b7525e", PAYER_TX],
          ["Settlement", "0x41a87c…ee83c1", SETTLEMENT_TX],
        ].map(([label, hash, href]) => (
          <a
            key={label}
            href={href}
            target="_blank"
            rel="noreferrer"
            class="group grid min-h-12 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 bg-paper px-3 py-3 text-sm text-ink outline-offset-4 transition-colors hover:text-forest focus-visible:outline-2 focus-visible:outline-accent md:gap-3 md:px-4"
          >
            <span class="label whitespace-nowrap text-ink group-hover:text-forest">{label}</span>
            <span class="min-w-0 truncate whitespace-nowrap text-right font-mono text-xs md:text-sm">
              {hash}
            </span>
            <span aria-hidden="true">↗</span>
          </a>
        ))}
      </div>
    </div>
  );
}

export function AtomicTiles() {
  return (
    <div class="grid grid-cols-1 gap-px bg-line sm:grid-cols-3">
      <Card index="01" title="Correct amount" class="bg-paper">
        Signed minimum and deadline. <span class="font-mono text-forest">hard revert</span> below
        the lock.
      </Card>
      <Card index="02" title="Merchant control" class="bg-paper">
        Settlement only reaches an admitted <span class="text-forest">merchant wallet</span>.
      </Card>
      <Card index="03" title="Provable outcome" class="bg-paper">
        Chain event → balanced ledger → <span class="font-mono text-forest">MATCHED</span>.
      </Card>
    </div>
  );
}

type AudienceGlyph = "storefront" | "route" | "cross-border";

const AUDIENCE_ICON_PATHS: Readonly<Record<AudienceGlyph, readonly string[]>> = {
  storefront: [
    "M4 10.5h16M5.5 10.5V20h13v-9.5M3 10.5l1.8-6h14.4l1.8 6M8 14h3v6H8z",
    "M3 10.5c.5 1.3 1.5 2 3 2s2.5-.7 3-2c.5 1.3 1.5 2 3 2s2.5-.7 3-2c.5 1.3 1.5 2 3 2s2.5-.7 3-2",
  ],
  route: ["M5 5h5a4 4 0 0 1 4 4v6a4 4 0 0 0 4 4h1", "M16 16l3 3-3 3M8 2 5 5l3 3"],
  "cross-border": ["M5 3h10l4 4v14H5zM15 3v5h4M8 12h8M8 16h5", "M14 19h7M18 16l3 3-3 3"],
};

function AudienceIcon({ name }: { readonly name: AudienceGlyph }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      class="size-8 shrink-0 text-forest"
      fill="none"
      stroke="currentColor"
      stroke-width="1.25"
      stroke-linecap="square"
      stroke-linejoin="miter"
    >
      {AUDIENCE_ICON_PATHS[name].map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}

const AUDIENCE_PATH = [
  {
    stage: "Start here",
    icon: "storefront" as const,
    audience: "Merchant platforms",
    examples: "Marketplaces · commerce platforms",
    value: "Price locally · settle predictably",
  },
  {
    stage: "Expand",
    icon: "route" as const,
    audience: "Payment infrastructure",
    examples: "Processors · wallets · stablecoin platforms",
    value: "Add acceptance · keep the existing stack",
  },
  {
    stage: "Serve next",
    icon: "cross-border" as const,
    audience: "Cross-border sellers",
    examples: "Creators · freelancers · agencies",
    value: "Collect by link or invoice",
  },
] as const;

const PILOT_MEASURES = ["Settlement reliability", "Reconciliation", "Integration speed"] as const;

const CONTRACTS = [
  {
    name: "PaymentRouter",
    address: "0xEe7c5B5a9eeAf667A6EFb217A8a77534C873f7a9",
  },
  {
    name: "TimelockController",
    address: "0x0c006FC14063e3F78271312B975231e4BD6e8B00",
  },
  {
    name: "DepositForwarderFactory",
    address: "0x598F64551456BCa2536386ED54A24412E3e32fCe",
  },
] as const;

function compactAddress(address: string): string {
  return `${address.slice(0, 10)}…${address.slice(-8)}`;
}

export function AudienceAndGoal() {
  return (
    <div class="flex flex-col gap-px bg-line">
      <div class="grid grid-cols-1 gap-px md:grid-cols-3">
        {AUDIENCE_PATH.map(({ stage, icon, audience, examples, value }) => (
          <div key={stage} data-reveal class="flex min-w-0 flex-col gap-3 bg-paper p-5 md:min-h-48">
            <div class="flex items-center justify-between gap-4">
              <span class="label text-forest">{stage}</span>
              <AudienceIcon name={icon} />
            </div>
            <span class="font-sans text-xl font-medium leading-tight tracking-tight text-ink md:text-2xl">
              {audience}
            </span>
            <span class="text-sm leading-relaxed text-ink">{examples}</span>
            <span class="mt-auto border-t border-line pt-3 font-mono text-xs text-ink">
              {value}
            </span>
          </div>
        ))}
      </div>
      <div data-reveal class="flex flex-col gap-5 bg-paper p-5">
        <div class="flex flex-col gap-1.5 border-l border-accent pl-4">
          <span class="font-mono text-xs text-forest md:text-sm">Southeast Asia beachhead</span>
          <span class="font-sans text-xl font-medium leading-tight tracking-tight text-ink md:text-2xl">
            Goal · controlled merchant pilot
          </span>
        </div>
        <ul class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {PILOT_MEASURES.map((measure, index) => (
            <li key={measure} class="flex items-center gap-3 border-t border-line pt-3">
              <span class="font-mono text-xs text-forest">0{index + 1}</span>
              <span class="text-sm text-ink">{measure}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const HOSTS = [
  "mayarin.xyz",
  "api-testnet.mayarin.xyz",
  "dashboard-testnet.mayarin.xyz",
  "pay-testnet.mayarin.xyz",
  "docs.mayarin.xyz",
] as const;

export function LiveSurfaces() {
  return (
    <div class="flex flex-col gap-8">
      <div>
        <p data-reveal class="label mb-3 text-ink">
          Live hosts
        </p>
        <ul class="flex flex-col">
          {HOSTS.map((host) => (
            <li key={host} data-reveal class="border-t border-line py-2.5 last:border-b">
              <a
                href={`https://${host}`}
                target="_blank"
                rel="noreferrer"
                class="font-mono text-sm text-ink hover:text-forest md:text-base"
              >
                {host}
              </a>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p data-reveal class="label mb-3 text-ink">
          Base Sepolia · verified
        </p>
        <ul class="flex flex-col">
          {CONTRACTS.map((contract) => (
            <li
              key={contract.name}
              data-reveal
              class="flex items-baseline justify-between gap-4 border-t border-line py-2.5 last:border-b"
            >
              <span class="text-sm text-ink">{contract.name}</span>
              <span class="font-mono text-xs text-forest md:text-sm">
                {compactAddress(contract.address)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const CLOSING_OUTCOME = [
  ["01 · Price", "SGD · MYR · IDR"],
  ["02 · Pay", "Supported crypto"],
  ["03 · Settle", "Stablecoin"],
] as const;

export function ClosingOutcome() {
  return (
    <div class="flex h-full flex-col justify-between gap-8 border border-line p-6 md:p-8">
      <div data-reveal class="flex flex-col gap-4">
        <span class="label text-ink">The outcome</span>
        <p class="font-sans text-3xl leading-tight text-ink md:text-4xl">
          Price locally. Pay globally. Settle predictably.
        </p>
        <p class="max-w-lg text-base leading-relaxed text-ink md:text-lg">
          One auditable payment into a merchant-controlled wallet.
        </p>
      </div>
      <ol data-reveal class="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {CLOSING_OUTCOME.map(([step, value]) => (
          <li key={step} class="flex flex-col gap-2 border-t border-line pt-3">
            <span class="label text-ink">{step}</span>
            <span class="font-mono text-sm text-forest md:text-base">{value}</span>
          </li>
        ))}
      </ol>
      <div data-reveal class="flex items-center justify-between gap-4 border-t border-line pt-4">
        <span class="label text-ink">Next</span>
        <span class="font-mono text-sm text-forest">Controlled mainnet pilot</span>
      </div>
    </div>
  );
}

export function ArchitectureFlow() {
  return (
    <figure data-reveal class="flex h-full w-full items-center justify-center">
      <img
        src="/images/pitch-deck/mayarin-architecture-flow.png"
        alt="Mayarin architecture: merchant intent and customer asset choice enter the Mayarin API, which coordinates quoting, on-chain payment routing or transfer watching, clearing, double-entry accounting, and stablecoin settlement to the merchant."
        width="2898"
        height="1406"
        class="max-h-[calc(100dvh-26rem)] min-h-0 w-full object-contain"
        loading="lazy"
        decoding="async"
      />
      <figcaption class="sr-only">
        One orchestration layer coordinates two execution paths that converge on one auditable
        stablecoin settlement outcome.
      </figcaption>
    </figure>
  );
}

export function RiskColumns() {
  return (
    <div class="grid grid-cols-2 gap-px bg-line">
      <div data-reveal class="flex flex-col gap-4 bg-paper p-5 md:p-6">
        <span class="label text-ink">Bounded by design</span>
        <ul class="flex flex-col gap-2 text-sm text-ink">
          <li>Signing keys in KMS or Turnkey, timelocked rotation</li>
          <li>Multisig governance, router pause</li>
          <li>Payouts allowlisted to merchant Safes</li>
          <li>Hard revert below the locked minimum</li>
        </ul>
      </div>
      <div data-reveal class="flex flex-col gap-4 bg-paper p-5 md:p-6">
        <span class="label text-ink">Accepted for now</span>
        <ul class="flex flex-col gap-2 text-sm text-ink">
          <li>Stablecoin depeg — guard is RFC #71</li>
          <li>Deposit-path operator custody while sweeping</li>
          <li>Oracle, DEX, RPC, and issuer dependence</li>
          <li>Forwarder without adversarial review — RFC #143</li>
        </ul>
      </div>
    </div>
  );
}

const CLAIMS = [
  ["Atomic receive → swap → settle in one transaction", "Live", "chain.md"],
  ["Contract holds no balance between payments", "Live", "chain.md"],
  ["Both execution paths settle on Base Sepolia", "Live", "chain.md"],
  ["Merchant always a signer on their Safe", "Live", "wallet.md"],
  ["Payouts only to verified merchant wallets", "Live", "wallet.md"],
  ["Passkey key that Mayarin cannot use", "Provider-backed", "wallet.md"],
  ["Oracles, venues, wallet provider behind ports", "Provider-backed", "architecture.md"],
  ["Exact money, no floats", "Live", "money.md"],
  ["Double-entry ledger reconciled against the chain", "Live", "ledger.md"],
  ["Commerce surface, dashboard, SDK, webhooks, SSE", "Live", "roadmap.md"],
  ["WooCommerce plugin, embeddable checkout", "Live", "woocommerce.md"],
  ["On-chain fee and refund split policy", "Next · #12", "roadmap.md"],
  ["Gas-free merchant withdrawal", "Next · #9", "roadmap.md"],
  ["Passkey browser ceremony in the dashboard", "Next", "roadmap.md"],
  ["More assets, venues, EVM chains, Solana, TRON", "Next · Phase 5", "roadmap.md"],
  ["Cross-chain settlement", "On Roadmap", "roadmap.md"],
  ["Fiat off-ramp", "On Roadmap", "roadmap.md"],
  ["Agent Pay", "On Roadmap", "PURPOSE.md §21"],
  ["Stablecoin depeg", "Accepted risk", "threat-model.md"],
  ["Deposit-path operator custody", "Accepted risk", "threat-model.md"],
  ["Deposit forwarder without adversarial review", "Accepted risk", "RFC #143"],
] as const;

export function ClaimLedger() {
  return (
    <div data-scroll class="max-h-[calc(100dvh-24rem)] overflow-auto border border-line">
      <table class="w-full border-collapse text-left text-sm">
        <thead class="sticky top-0 bg-paper">
          <tr class="border-b border-line">
            <th scope="col" class="label px-4 py-3 font-medium text-ink">
              Claim
            </th>
            <th scope="col" class="label px-4 py-3 font-medium text-ink">
              Status
            </th>
            <th scope="col" class="label px-4 py-3 font-medium text-ink">
              Source
            </th>
          </tr>
        </thead>
        <tbody>
          {CLAIMS.map(([claim, status, source]) => (
            <tr key={claim} class="border-b border-line last:border-b-0">
              <td class="px-4 py-2.5 text-ink">{claim}</td>
              <td
                class={clsx(
                  "px-4 py-2.5 font-mono text-xs",
                  status.startsWith("Live") ? "text-forest" : "text-ink",
                )}
              >
                {status}
              </td>
              <td class="px-4 py-2.5 font-mono text-xs text-ink">{source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
