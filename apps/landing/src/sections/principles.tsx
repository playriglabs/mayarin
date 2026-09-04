import clsx from "clsx";
import { Reveal } from "../components/reveal.tsx";
import { Label, Lede, Section, SectionHeading } from "../components/ui.tsx";
import { principleGlyphs } from "../graphics/glyphs.tsx";

const PRINCIPLES = [
  {
    icon: principleGlyphs.abstractRail,
    title: "Abstract the rail",
    body: "A rail is an implementation detail of getting paid. Products should express intent; the infrastructure decides how that intent reaches a chain or a settlement wallet.",
  },
  {
    icon: principleGlyphs.providerAgnostic,
    title: "Stay provider-agnostic",
    body: "Every provider is temporary. Ports keep the domain independent of who is currently cheapest, fastest or licensed in a given market.",
  },
  {
    icon: principleGlyphs.oneLedger,
    title: "Keep one ledger",
    body: "Balances are consequences, not inputs. A single double-entry ledger is what makes reconciliation an arithmetic fact instead of a monthly exercise.",
  },
  {
    icon: principleGlyphs.programmable,
    title: "Make settlement programmable",
    body: "Conditions, splits, timing and destination assets belong in code you can test — not in an operations runbook.",
  },
  {
    icon: principleGlyphs.onChainTruth,
    title: "Confirm against the chain",
    body: "A webhook is a signal and a facilitator's success is a claim. Nothing advances until the transaction is read back off the chain and matched to this payment.",
  },
  {
    icon: principleGlyphs.explicitCustody,
    title: "Draw custody boundaries",
    body: "The atomic path never holds the payer's asset; the deposit path briefly does; a facilitator broadcasts but cannot change the amount or the recipient.",
  },
  {
    icon: principleGlyphs.compose,
    title: "Compose, don't couple",
    body: "Each layer is useful alone and stronger together. Take the whole clearing path, or the one piece your stack is missing.",
  },
];

export function Principles() {
  return (
    <Section id="principles">
      <Reveal>
        <Label>Infrastructure principles</Label>
      </Reveal>

      <div class="md:flex md:items-end md:justify-between md:gap-20">
        <Reveal delay={60}>
          <SectionHeading>Money moves. Infrastructure orchestrates.</SectionHeading>
        </Reveal>
        <Reveal delay={120}>
          <Lede class="md:mb-3 md:max-w-[34ch]">
            Seven commitments the codebase is arranged to protect — and that any change, on any of
            the three execution paths, has to keep true.
          </Lede>
        </Reveal>
      </div>

      {/* Keep phone-landscape, tablet and compact-laptop cards comfortably
          readable in two columns. The denser three-over-four bento only starts
          once the viewport is wide enough to preserve that reading measure. */}
      <div class="mt-12 grid gap-px border-y border-line bg-line sm:grid-cols-2 md:mt-16 2xl:grid-cols-12">
        {PRINCIPLES.map((principle, index) => (
          <Reveal
            key={principle.title}
            delay={(index % 4) * 70}
            class={clsx(
              "group flex h-full flex-col bg-paper px-6 py-9 md:p-10",
              index < 3 ? "2xl:col-span-4" : "2xl:col-span-3",
              // Seven cells over two columns leaves a hole in the last row, and
              // the hole would show the grid's hairline colour as a block.
              index === PRINCIPLES.length - 1 && "sm:col-span-2 2xl:col-span-3",
            )}
          >
            <span class="text-forest transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-1 [&>svg]:size-9">
              {principle.icon}
            </span>
            <h4 class="mt-8 font-display text-[clamp(1.5rem,2vw,1.9rem)] leading-[1.1] tracking-[-0.02em] transition-transform duration-300 group-hover:translate-x-1">
              {principle.title}
            </h4>
            <p class="mt-4 max-w-[38ch] text-[0.9375rem] leading-[1.75] text-slate">
              {principle.body}
            </p>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
