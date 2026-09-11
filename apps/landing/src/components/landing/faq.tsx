import clsx from "clsx";
import { useId, useState } from "preact/hooks";
import { Reveal } from "../reveal.tsx";
import { SectionIntro } from "./ui.tsx";

/**
 * Only questions with a settled answer. Fees and licensing stay off this list
 * until they are decided: a vague answer costs more trust than no answer.
 */
const QUESTIONS = [
  {
    question: "Who holds the money?",
    answer:
      "You do. Settlements land in a wallet you control — a Safe or a wallet you verify in the dashboard. On the contract path Mayarin never holds your customer's funds; on the deposit path they pass through a per-payment address only until the payment settles.",
  },
  {
    question: "Do my customers need the currency I receive?",
    answer:
      "No. They pay with any supported asset on any supported network. You set the price in your local currency and receive a stablecoin, and Mayarin handles the conversion in between.",
  },
  {
    question: "Do I need to understand blockchain?",
    answer:
      "No. You price in your own currency and share a payment link, an invoice or a QR code. Choosing the network and converting the asset happen behind the checkout.",
  },
  {
    question: "Can I cash out to my bank account?",
    answer:
      "Yes. Mayarin settles in stablecoins to your own wallet, and you can cash them out to your bank account through a third-party provider.",
  },
  {
    question: "Is Mayarin live?",
    answer:
      "Mayarin runs on testnet today, so no real money moves yet. Join early access and we will let you know when live payments open.",
  },
] as const;

function PlusIcon({ open }: { readonly open: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      aria-hidden="true"
      class={clsx(
        "shrink-0 text-forest transition-transform duration-300 ease-out-expo motion-reduce:transition-none",
        open && "rotate-45",
      )}
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/**
 * A button and a grid row rather than `<details>`: a closed `<details>` has no
 * height to animate from in most browsers, while `grid-template-rows` moves
 * between `0fr` and `1fr` smoothly everywhere.
 */
function Question({ question, answer }: { readonly question: string; readonly answer: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <div class="border-b border-line">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        class="flex w-full cursor-pointer items-center justify-between gap-6 py-6 text-left font-sans text-lg font-medium transition-colors hover:text-forest"
      >
        {question}
        <PlusIcon open={open} />
      </button>
      <div
        id={id}
        inert={!open}
        class={clsx(
          "grid transition-[grid-template-rows] duration-500 ease-out-expo motion-reduce:transition-none",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div class="overflow-hidden">
          <p
            class={clsx(
              "max-w-[60ch] pb-6 text-[15px] leading-relaxed text-slate-600 transition-opacity duration-500 ease-out-expo motion-reduce:transition-none",
              open ? "opacity-100" : "opacity-0",
            )}
          >
            {answer}
          </p>
        </div>
      </div>
    </div>
  );
}

export function Faq() {
  return (
    <section id="faq" class="mx-auto w-full max-w-300 px-5 py-20 md:px-10 md:py-28">
      <div class="grid items-start gap-12 lg:grid-cols-[0.85fr_1.4fr] lg:gap-16">
        <Reveal>
          <SectionIntro
            centered={false}
            title={
              <>
                Questions merchants
                <br />
                <span>ask first.</span>
              </>
            }
          >
            Short answers to what comes up before the first payment.
          </SectionIntro>
        </Reveal>
        <Reveal delay={120} class="border-t border-line">
          {QUESTIONS.map((item) => (
            <Question key={item.question} question={item.question} answer={item.answer} />
          ))}
        </Reveal>
      </div>
    </section>
  );
}
