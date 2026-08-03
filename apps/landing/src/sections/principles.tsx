import { Reveal } from "../components/reveal.tsx";
import { Label, Lede, Section, SectionHeading } from "../components/ui.tsx";

const PRINCIPLES = [
  {
    title: "Abstract the rail",
    body: "A rail is an implementation detail of getting paid. Products should express intent; the infrastructure decides how that intent reaches a bank, a QR standard or a chain.",
  },
  {
    title: "Stay provider-agnostic",
    body: "Every provider is temporary. Ports keep the domain independent of who is currently cheapest, fastest or licensed in a given corridor.",
  },
  {
    title: "Make settlement programmable",
    body: "Conditions, splits, timing and destination assets belong in code you can test — not in an operations runbook.",
  },
  {
    title: "Keep one ledger",
    body: "Balances are consequences, not inputs. A single double-entry ledger is what makes reconciliation an arithmetic fact instead of a monthly exercise.",
  },
  {
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
            Five commitments the codebase is arranged to protect — and that any change has to keep
            true.
          </Lede>
        </Reveal>
      </div>

      <div class="mt-12 md:mt-16">
        {PRINCIPLES.map((principle, index) => (
          <Reveal
            key={principle.title}
            delay={index * 60}
            class="grid gap-4 border-t border-line py-8 last:border-b md:grid-cols-[1fr_1.15fr] md:gap-16 md:py-12"
          >
            <h3 class="text-[clamp(1.5rem,2.8vw,2.125rem)] leading-[1.12]">{principle.title}</h3>
            <p class="max-w-[56ch] text-[0.9375rem] leading-[1.8] text-slate">{principle.body}</p>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
