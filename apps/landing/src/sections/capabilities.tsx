import { Reveal } from "../components/reveal.tsx";
import { ScrambleText } from "../components/scramble-text.tsx";
import { Label, Lede, Section, SectionHeading } from "../components/ui.tsx";
import { type GlyphName, glyphs } from "../graphics/glyphs.tsx";

const CAPABILITIES: { name: string; glyph: GlyphName; body: string }[] = [
  {
    name: "Payment Orchestration",
    glyph: "orchestration",
    body: "One flow decides the route, the asset and the provider for every payment.",
  },
  {
    name: "Programmable Settlement",
    glyph: "settlement",
    body: "Settlement conditions expressed in code, not in a support ticket.",
  },
  {
    name: "Liquidity Routing",
    glyph: "routing",
    body: "Price the payer's asset and route it to what the destination rail accepts.",
  },
  {
    name: "Double-entry Ledger",
    glyph: "ledger",
    body: "Balances are never written directly. Value moves only as balanced postings.",
  },
  {
    name: "Clearing Engine",
    glyph: "clearing",
    body: "A nine-state machine that is idempotent, resumable and fully auditable.",
  },
  {
    name: "Settlement Engine",
    glyph: "engine",
    body: "Provider calls keyed per step, so a replay settles once and only once.",
  },
  {
    name: "Payment Intent",
    glyph: "intent",
    body: "An immutable aggregate with optimistic locking on every transition.",
  },
  {
    name: "Provider Adapters",
    glyph: "adapters",
    body: "Ports in the core, providers at the edge. Swap one without touching domain logic.",
  },
  {
    name: "QR Infrastructure",
    glyph: "qr",
    body: "EMVCo and QRIS parsing, validation and generation as first-class inputs.",
  },
  {
    name: "Merchant APIs",
    glyph: "api",
    body: "Typed resources, idempotency keys, signed webhooks, replayable events.",
  },
  {
    name: "POS SDK",
    glyph: "sdk",
    body: "In-person acceptance that speaks the same intents as your server does.",
  },
  {
    name: "Treasury",
    glyph: "treasury",
    body: "Positions, balances and reconciliation derived from the ledger itself.",
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
            Use the whole clearing path, or reach for the one layer your stack is missing.
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
            <Reveal delay={(index % 3) * 70} class="h-full p-8 md:p-10">
              <span class="block text-ink transition-transform duration-500 ease-out-expo group-hover:translate-x-1">
                {glyphs[capability.glyph]}
              </span>
              <h3 class="mt-8 font-sans text-[0.9375rem] font-medium tracking-[-0.01em]">
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
