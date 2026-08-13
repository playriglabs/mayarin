import { Reveal } from "../components/reveal.tsx";
import { Label, Section, SectionHeading } from "../components/ui.tsx";

const USE_CASES = [
  {
    index: "01",
    title: "Merchant platforms",
    body: "Price in local currency, settle in a stablecoin — customers pay any supported crypto.",
  },
  {
    index: "02",
    title: "Payment processors",
    body: "Add digital-asset acceptance behind an existing processing stack without rebuilding settlement.",
  },
  {
    index: "03",
    title: "Wallets",
    body: "Turn a balance into a payment at any merchant, with clearing handled off the client.",
  },
  {
    index: "04",
    title: "Stablecoin platforms",
    body: "Give issued value somewhere to go: merchant payouts, treasury movements, on-chain settlement.",
  },
  {
    index: "05",
    title: "Marketplaces",
    body: "Split, hold and release funds against a ledger that reconciles itself by construction.",
  },
  {
    index: "06",
    title: "Cross-border commerce",
    body: "Route across assets and chains per payment, priced at lock time, settled in the merchant's stablecoin.",
  },
  {
    index: "07",
    title: "Content creators",
    body: "Share a payment link for tips, commissions or digital work — priced locally and payable with supported crypto assets.",
  },
  {
    index: "08",
    title: "Freelancers & agencies",
    body: "Issue an invoice with your own reference, collect across borders and reconcile every payment to the right client.",
  },
];

export function UseCases() {
  return (
    <Section id="use-cases">
      <Reveal>
        <Label>Use cases</Label>
      </Reveal>

      <Reveal delay={60}>
        <SectionHeading>Wherever value has to cross a boundary.</SectionHeading>
      </Reveal>

      <div class="mt-12 border-t border-line md:mt-16">
        {USE_CASES.map((useCase, index) => (
          <Reveal
            key={useCase.index}
            delay={(index % 2) * 80}
            class="group grid grid-cols-1 gap-4 border-b border-line py-8 transition-colors duration-300 md:grid-cols-[6rem_1fr_1.1fr] md:items-center md:gap-8 md:py-10"
          >
            <span class="label text-slate text-base">{useCase.index}</span>
            <h3 class="font-display top text-[clamp(2rem,3vw,2.25rem)] leading-[1.1]">
              {useCase.title}
            </h3>
            <p class="max-w-[52ch] text-[0.9375rem] leading-[1.7] text-slate">{useCase.body}</p>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
