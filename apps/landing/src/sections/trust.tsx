import { Reveal } from "../components/reveal.tsx";
import { Label, Lede, Rule, Section, SectionHeading } from "../components/ui.tsx";
import { RoutingTopology } from "../graphics/topology.tsx";

const PILLARS = [
  {
    title: "Developer-first",
    body: "Every state a payment can occupy is a state you can read, replay and reason about. Steps are keyed and idempotent, so a retry moves no value twice.",
  },
  {
    title: "API-first",
    body: "Typed resources, idempotency keys on every mutation, webhooks that wake the engine instead of being trusted as truth. Nothing important happens only in a dashboard.",
  },
  {
    title: "Provider-agnostic",
    body: "Domain logic depends on ports, never on providers. Changing a settlement provider, a chain client, a price feed or a database is a composition change, not a rewrite.",
  },
];

const FACTS = [
  { figure: "3", caption: "payer classes on one path: a person, an application, an agent" },
  { figure: "3", caption: "execution paths — contract, deposit-match, x402 — chosen per payment" },
  { figure: "1:1", caption: "every posting balanced on write, or it never lands" },
  { figure: "100%", caption: "of transitions appended as events in the same transaction" },
];

export function Trust() {
  return (
    <Section id="platform">
      <Reveal>
        <Label>Trusted infrastructure</Label>
      </Reveal>

      <div class="md:flex md:items-end md:justify-between md:gap-16">
        <Reveal delay={60}>
          <SectionHeading>Built like financial infrastructure, not like a plugin.</SectionHeading>
        </Reveal>
        <Reveal delay={120}>
          <Lede class="md:mb-3 md:max-w-[34ch]">
            Many kinds of payer and many sources of value collapse into one clearing path, then fan
            back out to the stablecoin a merchant actually gets paid in.
          </Lede>
        </Reveal>
      </div>

      <Reveal delay={120} class="mt-14 md:mt-20">
        <RoutingTopology />
      </Reveal>

      <div class="mt-14 grid gap-px bg-line md:mt-20 md:grid-cols-3">
        {PILLARS.map((pillar, index) => (
          <div key={pillar.title} class="bg-paper py-8 md:px-8 md:py-2 md:first:pl-0">
            <Reveal delay={index * 90}>
              <h3 class="text-2xl font-medium tracking-[-0.01em]">{pillar.title}</h3>
              <p class="mt-4 max-w-[42ch] text-[0.9375rem] leading-[1.7] text-slate">
                {pillar.body}
              </p>
            </Reveal>
          </div>
        ))}
      </div>

      <Rule class="mt-12 md:mt-16" />

      <dl class="grid grid-cols-2 gap-x-8 gap-y-12 pt-12 md:grid-cols-4">
        {FACTS.map((fact, index) => (
          <Reveal key={fact.caption} delay={index * 70}>
            <dt class="font-display text-[clamp(2.75rem,5vw,4rem)] leading-none tracking-[-0.03em]">
              {fact.figure}
            </dt>
            <dd class="mt-4 max-w-[24ch] text-sm leading-[1.6] text-slate">{fact.caption}</dd>
          </Reveal>
        ))}
      </dl>
    </Section>
  );
}
