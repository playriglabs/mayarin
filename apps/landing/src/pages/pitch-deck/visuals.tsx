import clsx from "clsx";
import type { ComponentChildren } from "preact";

/*
 * The visual half of each slide. Every visual is plain markup on the dark
 * ground: hairlines, mono labels, and the accent green. Pieces that should
 * stagger in carry `data-reveal`; the deck shell animates them on entry.
 */

const SETTLEMENT_TX =
  "https://sepolia.basescan.org/tx/0x41a87c05e673ed17b80ef5009813b932db74e095d4cdfca2c5dfdda49bee83c1";

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
    <div
      data-reveal
      class={clsx("flex flex-col gap-3 border border-line-inverse p-5 md:p-6", className)}
    >
      {index ? <span class="label text-slate-inverse">{index}</span> : null}
      <h3 class="font-sans text-base font-medium tracking-normal text-white md:text-lg">{title}</h3>
      {children ? <p class="text-sm leading-relaxed text-slate-inverse">{children}</p> : null}
    </div>
  );
}

export function TitleLockup() {
  return (
    <div class="flex h-full flex-col items-start justify-between gap-10">
      <img
        data-reveal
        src="/brand-kit/mayarin-full-white.png"
        alt="Mayarin"
        width="640"
        height="160"
        class="w-full max-w-88 md:max-w-120 md:-ml-11.5"
        decoding="async"
      />
      <div data-reveal class="flex flex-wrap items-end gap-x-10 gap-y-4">
        <div class="flex flex-col gap-2">
          <span class="label text-slate-inverse">Pronounced</span>
          <span class="font-mono text-lg text-white md:text-2xl">/maɪˈjɑːrɪn/</span>
        </div>
        <a
          href="https://mayarin.xyz"
          class="font-mono text-sm text-accent hover:text-white md:text-base"
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
      class="size-4 shrink-0 text-accent"
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
      class="size-4 shrink-0 text-accent"
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
    <div class="grid grid-cols-1 gap-px bg-line-inverse sm:grid-cols-2">
      {TEAM.map((member) => (
        <article key={member.name} data-reveal class="min-w-0 bg-void">
          <div class="aspect-square overflow-hidden bg-void">
            <img
              src={member.image}
              alt={`${member.name}, ${member.role} at Mayarin`}
              width="800"
              height="800"
              class={clsx("team-photo", member.imageClass)}
              decoding="async"
            />
          </div>
          <div class="flex flex-col gap-1 border-t border-line-inverse p-4 md:p-5">
            <span class="font-sans text-lg text-white md:text-xl">{member.name}</span>
            <span class="font-mono text-xs text-accent md:text-sm">{member.role}</span>
            <span class="text-xs text-slate-inverse md:text-sm">{member.experience}</span>
            <nav
              aria-label={`${member.name} profiles`}
              class="mt-3 grid grid-cols-2 gap-px bg-line-inverse"
            >
              {member.links.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`${member.name} ${link.label}, opens in a new tab`}
                  class="inline-flex min-h-11 min-w-0 items-center gap-2 bg-void px-3 font-mono text-[0.7rem] text-slate-inverse outline-offset-4 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-accent md:text-xs"
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
    <div class="flex flex-col gap-px bg-line-inverse">
      <div class="bg-void px-5 pt-5 md:px-6 md:pt-6">
        <p class="label mb-2 text-slate-inverse">Settlement thesis</p>
        <ol>
          {SETTLEMENT_PROPERTIES.map(([index, title, detail]) => (
            <li
              key={index}
              data-reveal
              class="grid grid-cols-[2rem_1fr] gap-x-4 border-t border-line-inverse py-3 last:border-b"
            >
              <span class="label pt-1 text-accent">{index}</span>
              <div class="flex flex-col gap-1">
                <h3 class="font-sans text-base text-white md:text-lg">{title}</h3>
                <p class="text-xs leading-relaxed text-slate-inverse md:text-sm">{detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
      <div class="bg-void px-5 py-4 md:px-6 md:py-5">
        <p class="label mb-2 text-slate-inverse">Institutional signal · official sources</p>
        <ul class="grid grid-cols-2 gap-x-5">
          {INSTITUTIONAL_SIGNALS.map(([name, signal, href]) => (
            <li key={name} data-reveal class="min-w-0 border-t border-line-inverse">
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                aria-label={`Verify ${name}: ${signal}, opens primary source in a new tab`}
                class="group flex min-h-11 items-center justify-between gap-3 py-2.5 outline-offset-4 transition-colors focus-visible:outline-2 focus-visible:outline-accent"
              >
                <span class="min-w-0">
                  <span class="label block text-white group-hover:text-accent">{name}</span>
                  <span class="mt-1 block font-mono text-[0.7rem] leading-relaxed text-accent md:text-xs">
                    {signal}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  class="shrink-0 text-slate-inverse transition-colors group-hover:text-white"
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
    <div class="grid grid-cols-2 gap-px bg-line-inverse">
      <Card index="Merchant" title="Becomes a treasury desk" class="bg-void">
        Keys, wallets, swaps, gas, reconciliation.
      </Card>
      <Card index="Customer" title="Holds the wrong token" class="bg-void">
        Wallets are not built for invoices.
      </Card>
      <Card index="Developer" title="Rebuilds the state machine" class="bg-void">
        APIs, wallets, DEXs, chains — all fragmented.
      </Card>
      <Card index="Infrastructure" title="Drifts from the chain" class="bg-void">
        Reorgs, replayed webhooks, accidental custody.
      </Card>
    </div>
  );
}

export function ThreeColumns() {
  return (
    <div class="flex flex-col gap-px bg-line-inverse">
      <div class="grid grid-cols-1 gap-px md:grid-cols-3">
        <Card index="Merchant" title="Prices in IDR" class="bg-void">
          Picks the stablecoin they settle in.
        </Card>
        <Card index="Mayarin" title="Quotes, locks, converts, settles, records" class="bg-void">
          One atomic on-chain step when assets differ.
        </Card>
        <Card index="Customer" title="Pays in any asset" class="bg-void">
          From any wallet. ETH, USDC, USDT, IDRX.
        </Card>
      </div>
      <div
        data-reveal
        class="flex flex-wrap items-center gap-x-6 gap-y-2 bg-void px-5 py-4 md:px-6"
      >
        <span class="label text-slate-inverse">Not</span>
        {["an exchange", "a custodial wallet", "a bank or fiat rail", "a fiat off-ramp"].map(
          (item) => (
            <span key={item} class="text-sm text-white">
              {item}
            </span>
          ),
        )}
      </div>
    </div>
  );
}

const FLOW = [
  { label: "Customer", detail: "ETH · live testnet quote" },
  { label: "PaymentRouter", detail: "receives" },
  { label: "Swap", detail: "ETH → USDC, atomic" },
  { label: "Merchant wallet", detail: "USDC · net settlement" },
  { label: "Ledger", detail: "indexed event" },
] as const;

export function FlowDiagram() {
  return (
    <div class="flex h-full flex-col justify-between gap-8">
      <ol class="flex flex-col">
        {FLOW.map((step, index) => (
          <li
            key={step.label}
            data-reveal
            class="flex items-baseline gap-4 border-t border-line-inverse py-3 last:border-b md:gap-6"
          >
            <span class="label w-8 shrink-0 text-slate-inverse">0{index + 1}</span>
            <span class="font-sans text-base text-white md:text-lg">{step.label}</span>
            <span class="ml-auto font-mono text-xs text-accent md:text-sm">{step.detail}</span>
          </li>
        ))}
      </ol>
      <a
        data-reveal
        href={SETTLEMENT_TX}
        target="_blank"
        rel="noreferrer"
        class="group inline-flex items-center gap-3 self-start border border-line-inverse px-4 py-3 text-sm text-white transition-colors hover:border-accent"
      >
        <span class="label text-slate-inverse group-hover:text-accent">Base Sepolia</span>
        <span class="font-mono">0x41a87c05…ee83c1</span>
        <span aria-hidden="true">↗</span>
      </a>
    </div>
  );
}

export function AtomicTiles() {
  return (
    <div class="grid grid-cols-2 gap-px bg-line-inverse">
      <Card index="01" title="One transaction" class="bg-void">
        receive → swap → settle. Zero resting balance.
      </Card>
      <Card index="02" title="Merchant-held keys" class="bg-void">
        Always a Safe signer, with independent recovery. Payouts only to verified wallets.
      </Card>
      <Card index="03" title="Ports, not vendors" class="bg-void">
        Turnkey · Uniswap · 0x · LiFi · Pyth · Chainlink.
      </Card>
      <Card index="04" title="Ledger from chain truth" class="bg-void">
        Balanced postings, reconciled. Idempotent, resumable.
      </Card>
    </div>
  );
}

const SURFACES = [
  ["Buyer", "Payment links · QR · hosted and embedded checkout"],
  ["Merchant", "Dashboard · wallet · settlement · signed webhooks"],
  ["Developer", "TypeScript SDK · REST API · WooCommerce"],
] as const;

const BASE_SEPOLIA_ADDRESS_URL = "https://sepolia.basescan.org/address";

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

export function ProofAndPilot() {
  return (
    <div class="flex flex-col gap-px bg-line-inverse">
      <div class="grid grid-cols-1 gap-px md:grid-cols-3">
        {SURFACES.map(([surface, detail]) => (
          <div key={surface} data-reveal class="flex min-w-0 flex-col gap-3 bg-void p-5 md:p-6">
            <span class="label text-slate-inverse">{surface}</span>
            <span class="text-sm leading-relaxed text-white">{detail}</span>
          </div>
        ))}
      </div>
      <div data-reveal class="bg-void px-5 pt-4 md:px-6">
        <p class="label mb-2 text-slate-inverse">Base Sepolia · verified on-chain</p>
        <ul>
          {CONTRACTS.map((contract) => (
            <li
              key={contract.name}
              class="flex min-h-11 items-center justify-between gap-4 border-t border-line-inverse last:border-b"
            >
              <span class="text-xs text-white md:text-sm">{contract.name}</span>
              <a
                href={`${BASE_SEPOLIA_ADDRESS_URL}/${contract.address}`}
                target="_blank"
                rel="noreferrer"
                title={contract.address}
                aria-label={`Verify ${contract.name} at ${contract.address} on Base Sepolia Basescan`}
                class="inline-flex min-h-11 items-center font-mono text-xs text-accent outline-offset-4 hover:text-white focus-visible:outline-2 focus-visible:outline-accent md:text-sm"
              >
                {compactAddress(contract.address)}
                <span aria-hidden="true" class="ml-2">
                  ↗
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
      <div data-reveal class="flex flex-col gap-2 bg-void px-5 py-4 md:px-6">
        <span class="font-mono text-xs text-accent md:text-sm">
          Both execution paths settle end to end
        </span>
        <span class="label text-white">Next · controlled merchant pilot</span>
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
        <p data-reveal class="label mb-3 text-slate-inverse">
          Live hosts
        </p>
        <ul class="flex flex-col">
          {HOSTS.map((host) => (
            <li key={host} data-reveal class="border-t border-line-inverse py-2.5 last:border-b">
              <a
                href={`https://${host}`}
                target="_blank"
                rel="noreferrer"
                class="font-mono text-sm text-white hover:text-accent md:text-base"
              >
                {host}
              </a>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p data-reveal class="label mb-3 text-slate-inverse">
          Base Sepolia · verified
        </p>
        <ul class="flex flex-col">
          {CONTRACTS.map((contract) => (
            <li
              key={contract.name}
              data-reveal
              class="flex items-baseline justify-between gap-4 border-t border-line-inverse py-2.5 last:border-b"
            >
              <span class="text-sm text-white">{contract.name}</span>
              <span class="font-mono text-xs text-accent md:text-sm">
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
    <div class="flex h-full flex-col justify-between gap-8 border border-line-inverse p-6 md:p-8">
      <div data-reveal class="flex flex-col gap-4">
        <span class="label text-slate-inverse">The outcome</span>
        <p class="font-sans text-3xl leading-tight text-white md:text-4xl">
          Price locally. Pay globally. Settle predictably.
        </p>
        <p class="max-w-lg text-base leading-relaxed text-slate-inverse md:text-lg">
          One auditable payment into a merchant-controlled wallet.
        </p>
      </div>
      <ol data-reveal class="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {CLOSING_OUTCOME.map(([step, value]) => (
          <li key={step} class="flex flex-col gap-2 border-t border-line-inverse pt-3">
            <span class="label text-slate-inverse">{step}</span>
            <span class="font-mono text-sm text-accent md:text-base">{value}</span>
          </li>
        ))}
      </ol>
      <div
        data-reveal
        class="flex items-center justify-between gap-4 border-t border-line-inverse pt-4"
      >
        <span class="label text-slate-inverse">Next</span>
        <span class="font-mono text-sm text-accent">Controlled mainnet pilot</span>
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
    <div class="grid grid-cols-2 gap-px bg-line-inverse">
      <div data-reveal class="flex flex-col gap-4 bg-void p-5 md:p-6">
        <span class="label text-slate-inverse">Bounded by design</span>
        <ul class="flex flex-col gap-2 text-sm text-white">
          <li>Signing keys in KMS or Turnkey, timelocked rotation</li>
          <li>Multisig governance, router pause</li>
          <li>Payouts allowlisted to merchant Safes</li>
          <li>Hard revert below the locked minimum</li>
        </ul>
      </div>
      <div data-reveal class="flex flex-col gap-4 bg-void p-5 md:p-6">
        <span class="label text-slate-inverse">Accepted for now</span>
        <ul class="flex flex-col gap-2 text-sm text-white">
          <li>Stablecoin depeg — guard is RFC #71</li>
          <li>Deposit-path operator custody while sweeping</li>
          <li>Oracle, DEX, RPC, and issuer dependence</li>
          <li>Forwarder without adversarial review — RFC #143</li>
        </ul>
      </div>
    </div>
  );
}

const COMPARE_PATHS = [
  [
    "Custodial gateway",
    "Triple-A · BitPay",
    "payer → processor custody → scheduled payout → merchant",
  ],
  ["Ecosystem gateway", "Coinbase Commerce", "payer → one vendor's stack → merchant wallet"],
  ["Build it in-house", "Wallet + DEX + scripts", "payer → your keys, swaps, gas → your ledger"],
] as const;

export function ComparePaths() {
  return (
    <div class="flex flex-col">
      {COMPARE_PATHS.map(([model, who, path]) => (
        <div
          key={model}
          data-reveal
          class="flex flex-col gap-1.5 border-t border-line-inverse py-4"
        >
          <div class="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span class="font-sans text-base text-white md:text-lg">{model}</span>
            <span class="label text-slate-inverse">{who}</span>
          </div>
          <span class="font-mono text-xs leading-relaxed text-slate-inverse md:text-sm">
            {path}
          </span>
        </div>
      ))}
      <div data-reveal class="flex flex-col gap-1.5 border-y border-accent py-4">
        <span class="font-sans text-base text-white md:text-lg">Mayarin</span>
        <span class="font-mono text-xs leading-relaxed text-accent md:text-sm">
          payer → contract → merchant wallet · one atomic transaction
        </span>
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
  ["Cross-chain settlement", "Later", "roadmap.md"],
  ["Fiat off-ramp", "Later", "roadmap.md"],
  ["Agent Pay", "Later", "PURPOSE.md §21"],
  ["Stablecoin depeg", "Accepted risk", "threat-model.md"],
  ["Deposit-path operator custody", "Accepted risk", "threat-model.md"],
  ["Deposit forwarder without adversarial review", "Accepted risk", "RFC #143"],
] as const;

export function ClaimLedger() {
  return (
    <div data-scroll class="max-h-[calc(100dvh-24rem)] overflow-auto border border-line-inverse">
      <table class="w-full border-collapse text-left text-sm">
        <thead class="sticky top-0 bg-void">
          <tr class="border-b border-line-inverse">
            <th scope="col" class="label px-4 py-3 font-medium text-slate-inverse">
              Claim
            </th>
            <th scope="col" class="label px-4 py-3 font-medium text-slate-inverse">
              Status
            </th>
            <th scope="col" class="label px-4 py-3 font-medium text-slate-inverse">
              Source
            </th>
          </tr>
        </thead>
        <tbody>
          {CLAIMS.map(([claim, status, source]) => (
            <tr key={claim} class="border-b border-line-inverse last:border-b-0">
              <td class="px-4 py-2.5 text-white">{claim}</td>
              <td
                class={clsx(
                  "px-4 py-2.5 font-mono text-xs",
                  status.startsWith("Live") ? "text-accent" : "text-slate-inverse",
                )}
              >
                {status}
              </td>
              <td class="px-4 py-2.5 font-mono text-xs text-slate-inverse">{source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
