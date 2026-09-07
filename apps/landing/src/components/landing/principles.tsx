import { cloneElement } from "preact";
import { principleGlyphs } from "../../graphics/glyphs.tsx";
import { Reveal } from "../reveal.tsx";
import { CardCarousel } from "./card-carousel.tsx";
import { SectionIntro } from "./ui.tsx";

/** Same seven commitments the original landing page states, same marks. */
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
    icon: principleGlyphs.compose,
    title: "Compose, don't couple",
    body: "Each layer is useful alone and stronger together. Take the whole clearing path, or the one piece your stack is missing.",
  },
  {
    icon: principleGlyphs.programmable,
    title: "Settlement are programmable",
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
] as const;

export function Principles() {
  return (
    <section id="principles" class="mx-auto w-full max-w-300 px-6 py-20 md:px-10 md:py-28">
      <div class="grid items-start gap-12 lg:grid-cols-[0.85fr_1.4fr] lg:gap-16">
        <Reveal>
          <SectionIntro
            centered={false}
            title={
              <>
                Money moves.
                <br />
                <span>Infrastructure orchestrates.</span>
              </>
            }
          >
            Seven commitments the codebase is arranged to protect — and that any change, on any of
            the three execution paths, has to keep true.
          </SectionIntro>
        </Reveal>
        <CardCarousel
          id="v2-principle-track"
          ariaLabel="Infrastructure principles. Swipe or use the left and right arrow keys to explore."
          noun="principles"
          items={PRINCIPLES}
          pageSize={4}
          renderItem={(item) => (
            <article
              key={item.title}
              class="border-l border-line py-4 pl-6 pr-5 sm:min-h-64 md:pl-7"
            >
              <div class="flex items-start gap-3">
                <span class="flex size-9 shrink-0 items-center justify-center rounded-md bg-v2-mist text-forest [&>svg]:size-5">
                  {/* The glyphs are module-level vnodes shared with the original
                      landing page, and one vnode cannot be mounted twice — both
                      pages are rendered in the same prerender process. */}
                  {cloneElement(item.icon, {})}
                </span>
                <h3 class="pt-1 text-[1.5rem]">{item.title}</h3>
              </div>
              <p class="mt-6 text-[15px] leading-relaxed text-slate">{item.body}</p>
            </article>
          )}
        />
      </div>
    </section>
  );
}
