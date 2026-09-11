import { type Snippet, snippets } from "virtual:code-snippets";
import { useEffect, useRef, useState } from "preact/hooks";
import { gsap, registerGsap } from "../../lib/gsap.ts";
import { Reveal } from "../reveal.tsx";
import { ArrowRight } from "../ui.tsx";
import { CopyIcon } from "./capabilities.tsx";
import { LanguageMark } from "./language-mark.tsx";
import { SectionIntro } from "./ui.tsx";

const DOCS_URL = "https://docs.mayarin.xyz";

const SNIPPETS = new Map(snippets.map((snippet) => [snippet.id, snippet]));

const DEVELOPER_CARDS = [
  {
    eyebrow: "APIs & SDKs",
    title: "Start taking payments from one API",
    description:
      "Create payments, links and invoices from the typed TypeScript SDK or plain HTTP. Signed webhooks tell your server the moment money lands, and every step is on the event log.",
    cta: "Read the API quickstart",
    href: `${DOCS_URL}/guides/api-quickstart`,
    snippet: SNIPPETS.get("sdk-intent"),
  },
  {
    eyebrow: "x402",
    title: "Charge for any request with x402",
    description:
      "Register a URL, set its price, and close the gate with one middleware. Mayarin verifies the signature, settles on-chain and credits you, no key and no chain code on your server.",
    cta: "Sell an endpoint to an agent",
    href: `${DOCS_URL}/guides/x402`,
    snippet: SNIPPETS.get("x402-gate"),
  },
  {
    eyebrow: "Agents",
    title: "Let agents find you and pay you",
    description:
      "List an invoice, payment link or endpoint so an agent can discover it without a merchant id. It pays with one signature over HTTP or MCP, into the same ledger as every other sale.",
    cta: "See what an agent can pay",
    href: `${DOCS_URL}/guides/x402#payables-what-an-agent-can-find-and-pay`,
    snippet: SNIPPETS.get("agent-payables"),
  },
] as const;

/** The whole example, highlighted at build time, with a copy button. */
function CodePreview({ snippet }: { readonly snippet: Snippet }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard?.writeText(snippet.code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <div class="flex max-h-full min-h-0 min-w-0 flex-col self-center overflow-hidden rounded-2xl bg-code-panel">
      <div class="flex items-center justify-between gap-3 border-b border-line-inverse px-5 py-3.5">
        <div class="flex items-center gap-3">
          <LanguageMark lang={snippet.lang} />
          <span class="font-sans text-[13px] text-slate-inverse">{snippet.filename}</span>
        </div>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Copied" : "Copy code"}
          class="inline-flex cursor-pointer items-center text-slate-inverse transition-colors duration-200 hover:text-paper focus-visible:outline-accent"
        >
          <CopyIcon copied={copied} />
        </button>
      </div>
      <div
        class="code-surface min-h-0 min-w-0 flex-1 overflow-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&_pre]:[scrollbar-width:none] [&_pre::-webkit-scrollbar]:hidden"
        dangerouslySetInnerHTML={{ __html: snippet.html }}
      />
    </div>
  );
}

/**
 * Cards stack on scroll: each one is sticky under the navigation, so the next
 * card rises over it. GSAP only shrinks and dims the card being covered — the
 * stacking itself is CSS, so a reduced-motion or small-screen visitor still
 * gets a plain readable list.
 */
export function Developers() {
  const stack = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = stack.current;
    if (!root) return;
    registerGsap();

    const media = gsap.matchMedia();
    media.add("(min-width: 64rem) and (prefers-reduced-motion: no-preference)", () => {
      const cards = gsap.utils.toArray<HTMLElement>("[data-developer-card]", root);
      // Where a card sits in the stack, measured off the stack rather than the
      // card: a sticky card that is stuck when ScrollTrigger refreshes reports
      // where it is pinned, which would shift every start and end below it.
      const offset = (index: number) => {
        const gap = Number.parseFloat(getComputedStyle(root).rowGap) || 0;
        return cards.slice(0, index).reduce((sum, card) => sum + card.offsetHeight + gap, 0);
      };

      cards.forEach((card, index) => {
        if (index === cards.length - 1) return;
        gsap.to(card, {
          scale: 0.92,
          opacity: 0.4,
          ease: "none",
          scrollTrigger: {
            trigger: root,
            start: () => `top+=${offset(index + 1)} bottom`,
            // Matches the card's `lg:top-24` sticky offset.
            end: () => `top+=${offset(index + 1)} top+=96`,
            scrub: true,
            invalidateOnRefresh: true,
          },
        });
      });
    });

    return () => media.revert();
  }, []);

  return (
    <section id="developers" class="mx-auto w-full max-w-300 px-5 py-20 md:px-10 md:py-28">
      <Reveal>
        <SectionIntro
          label="For developers"
          title={
            <>
              Built for Developers, <span>by Developers</span>
            </>
          }
        >
          <p className="text-center">
            Integrate in hours using modern APIs and SDKs, with all the tools you need to launch
            smoothly.
          </p>
        </SectionIntro>
      </Reveal>

      <div ref={stack} class="mt-14 flex flex-col gap-6 md:mt-20">
        {DEVELOPER_CARDS.map((card) => (
          <article
            key={card.eyebrow}
            data-developer-card
            class="grid origin-top gap-10 rounded-3xl border border-line bg-v2-mist p-7 md:p-12 lg:sticky lg:top-24 lg:h-[min(36rem,calc(100svh-8rem))] lg:grid-cols-[1fr_1.1fr] lg:gap-16 lg:p-14"
          >
            <div class="flex flex-col">
              <p class="text-[15px] font-medium text-forest">{card.eyebrow}</p>
              <h4 class="mt-5 font-sans text-[clamp(2rem,3.4vw,2.4rem)]">{card.title}</h4>
              <p class="mt-6 max-w-[48ch] text-base leading-relaxed text-slate-600 md:text-lg">
                {card.description}
              </p>
              <a
                href={card.href}
                class="mt-8 inline-flex w-fit items-center gap-2 text-[15px] font-medium text-ink transition-colors hover:text-forest"
              >
                {card.cta}
                <ArrowRight />
              </a>
            </div>
            {card.snippet && <CodePreview snippet={card.snippet} />}
          </article>
        ))}
      </div>
    </section>
  );
}
