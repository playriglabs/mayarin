import { Reveal } from "../components/reveal.tsx";
import { ScrambleText } from "../components/scramble-text.tsx";
import { Label, Lede, Section, SectionHeading } from "../components/ui.tsx";
import { type GlyphName, glyphs } from "../graphics/glyphs.tsx";

const CAPABILITIES: { name: string; glyph: GlyphName; body: string }[] = [
  {
    name: "Payment Orchestration",
    glyph: "orchestration",
    body: "One flow decides the route, the asset and the execution path for every payment.",
  },
  {
    name: "Clearing Engine",
    glyph: "clearing",
    body: "A nine-state machine that is idempotent, resumable and fully auditable.",
  },
  {
    name: "Payment Intent",
    glyph: "intent",
    body: "An immutable aggregate with optimistic locking on every transition.",
  },
  {
    name: "Double-entry Ledger",
    glyph: "ledger",
    body: "Balances are never written directly. Value moves only as balanced postings.",
  },
  {
    name: "Liquidity Routing",
    glyph: "routing",
    body: "Oracle-guarded quotes and exact-output routes into the merchant's stablecoin.",
  },
  {
    name: "Programmable Settlement",
    glyph: "settlement",
    body: "A signed settlement minimum, a deadline and a slippage bound — expressed in code.",
  },
  {
    name: "Agent Payments",
    glyph: "agent",
    body: "x402 over the same clearing engine: any endpoint payable per call, no account issued.",
  },
  {
    name: "Chain Layer",
    glyph: "adapters",
    body: "Per-intent deposit addresses, confirmation depth, reorg detection and backfill.",
  },
  {
    name: "Commerce & Checkout",
    glyph: "qr",
    body: "Catalog, carts, payment links, invoices, hosted checkout and EMVCo or EIP-681 codes.",
  },
  {
    name: "Wallets & Treasury",
    glyph: "treasury",
    body: "Verified addresses, managed Safe accounts, balances and withdrawals off the ledger.",
  },
  {
    name: "Merchant APIs",
    glyph: "api",
    body: "Typed resources, idempotency keys, signed webhooks, replayable events, live status.",
  },
  {
    name: "TypeScript SDK",
    glyph: "sdk",
    body: "One server client, one browser client on publishable keys, both speaking the same intents.",
  },
];

export function Capabilities() {
  return (
    <Section id="capabilities">
      <Reveal>
        <Label>Capabilities</Label>
      </Reveal>

      <div class="md:flex md:items-end md:justify-between md:gap-20">
        <Reveal delay={60}>
          <SectionHeading>Every layer of a payment, addressable on its own.</SectionHeading>
        </Reveal>
        <Reveal delay={120}>
          <Lede class="md:mb-3 md:max-w-[36ch]">
            Use the whole clearing path, or reach for the one layer your stack is missing. Every one
            of these is shipped and running on testnet today.
          </Lede>
        </Reveal>
      </div>

      <div class="mt-12 grid gap-px border-y border-line bg-line md:mt-16 sm:grid-cols-2 lg:grid-cols-3">
        {/* The cell paints the background; the reveal only fades its contents,
            so an unrevealed cell never shows the hairline colour through. */}
        {CAPABILITIES.map((capability, index) => (
          <div
            key={capability.name}
            data-scramble-cell
            class="group bg-paper transition-colors duration-300 hover:bg-[#fafafa]"
          >
            <Reveal delay={(index % 3) * 70} class="h-full py-5 px-4 md:p-10">
              <span class="block text-ink transition-transform duration-500 ease-out-expo group-hover:translate-x-1">
                {glyphs[capability.glyph]}
              </span>
              <h3 class="mt-8 text-[1.2rem] tracking-[-0.01em]">
                <ScrambleText text={capability.name} trigger="[data-scramble-cell]" />
              </h3>
              <p class="mt-3 max-w-[34ch] text-sm leading-[1.7] text-slate">{capability.body}</p>
            </Reveal>
          </div>
        ))}
      </div>
    </Section>
  );
}
