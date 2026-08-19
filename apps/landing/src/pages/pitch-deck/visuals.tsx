import clsx from "clsx";
import type { ComponentChildren } from "preact";

/*
 * The visual half of each slide. Every visual is plain markup on the dark
 * ground: hairlines, mono labels, and the accent green. Pieces that should
 * stagger in carry `data-reveal`; the deck shell animates them on entry.
 */

const SETTLEMENT_TX =
  "https://sepolia.basescan.org/tx/0xa82acb6d93800f88c87552727d74733837bc9023df09b7d707ed9d0d08f03604";

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
        class="w-full max-w-[22rem] md:max-w-[30rem]"
        decoding="async"
      />
      <div data-reveal class="flex flex-col gap-2">
        <span class="label text-slate-inverse">Pronounced</span>
        <span class="font-mono text-lg text-white md:text-2xl">/maɪˈjɑːrɪn/</span>
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
      <div class="grid grid-cols-3 gap-px">
        <Card index="Merchant" title="Prices in rupiah" class="bg-void">
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
  { label: "Payer", detail: "0.003551410 ETH" },
  { label: "PaymentRouter", detail: "receives" },
  { label: "Swap", detail: "ETH → USDC, atomic" },
  { label: "Merchant wallet", detail: "0.556149 USDC" },
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
        <span class="font-mono">0xa82acb6d…f03604</span>
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
        Always a Safe signer. Payouts only to verified wallets.
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

const HOSTS = [
  "api-testnet.mayarin.xyz",
  "dashboard-testnet.mayarin.xyz",
  "pay-testnet.mayarin.xyz",
  "docs.mayarin.xyz",
] as const;

const CONTRACTS = [
  ["PaymentRouter", "0xEe7c…f7a9"],
  ["TimelockController", "0x0c00…8B00"],
  ["DepositForwarderFactory", "0x598F…2fCe"],
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
          {CONTRACTS.map(([name, address]) => (
            <li
              key={name}
              data-reveal
              class="flex items-baseline justify-between gap-4 border-t border-line-inverse py-2.5 last:border-b"
            >
              <span class="text-sm text-white">{name}</span>
              <span class="font-mono text-xs text-accent md:text-sm">{address}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const RINGS = [
  { r: 52, label: "Payment intent", items: [] },
  { r: 104, label: "Adapters", items: ["wallets", "venues", "oracles", "storage"] },
  { r: 156, label: "Chains", items: ["Base", "EVM", "Solana", "TRON"] },
  { r: 208, label: "Currencies", items: ["IDR", "MYR", "SGD", "USD"] },
] as const;

export function AdapterRings() {
  // 24px of padding around the outer ring keeps its labels inside the viewBox.
  const size = 480;
  const c = size / 2;
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="The payment intent at the centre, with adapters, chains, and currencies as rings around it"
      class="mx-auto h-auto w-full max-w-[28rem]"
    >
      {RINGS.map((ring, index) => (
        <g key={ring.label} data-reveal>
          <circle
            cx={c}
            cy={c}
            r={ring.r}
            fill={index === 0 ? "var(--color-accent)" : "none"}
            stroke={index === 0 ? "none" : "var(--color-line-inverse)"}
            stroke-width="1"
          />
          {index === 0 ? (
            <text
              x={c}
              y={c}
              text-anchor="middle"
              dominant-baseline="central"
              fill="var(--color-void)"
              font-family="var(--font-mono)"
              font-size="11"
              letter-spacing="0.12em"
            >
              INTENT
            </text>
          ) : (
            ring.items.map((item, i) => {
              const angle = -Math.PI / 2 + (i / ring.items.length) * Math.PI * 2;
              const x = c + Math.cos(angle) * ring.r;
              const y = c + Math.sin(angle) * ring.r;
              return (
                <g key={item}>
                  <circle cx={x} cy={y} r="3" fill="var(--color-accent)" />
                  <text
                    x={x}
                    y={y - 10}
                    text-anchor="middle"
                    fill="var(--color-slate-inverse)"
                    font-family="var(--font-mono)"
                    font-size="10"
                    letter-spacing="0.08em"
                  >
                    {item}
                  </text>
                </g>
              );
            })
          )}
        </g>
      ))}
    </svg>
  );
}

export function MerchantStory() {
  return (
    <div class="flex h-full flex-col justify-between gap-8 border border-line-inverse p-6 md:p-8">
      <div data-reveal class="flex flex-col gap-2">
        <span class="label text-slate-inverse">One story</span>
        <p class="font-display text-2xl leading-tight text-white md:text-4xl">
          A warung in Jakarta prices in rupiah. A tourist pays in ETH. The warung holds USDC — in a
          wallet only it controls.
        </p>
      </div>
      <dl data-reveal class="grid grid-cols-3 gap-4">
        {[
          ["Priced", "Rp 10.000"],
          ["Paid", "0.00355 ETH"],
          ["Received", "0.556 USDC"],
        ].map(([term, value]) => (
          <div key={term} class="flex flex-col gap-1 border-t border-line-inverse pt-3">
            <dt class="label text-slate-inverse">{term}</dt>
            <dd class="font-mono text-sm text-accent md:text-base">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
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
    <div data-reveal class="max-h-[calc(100dvh-24rem)] overflow-auto border border-line-inverse">
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
