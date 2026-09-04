import { Reveal } from "../components/reveal.tsx";
import { Label, Lede, Section, SectionHeading } from "../components/ui.tsx";

/**
 * The x402 handshake.
 *
 * Four steps, told as a sequence rather than as features, because the thing
 * worth understanding is the *order*: the resource is never served before the
 * settlement is confirmed, and a resource server cannot un-serve a response.
 *
 * The two illustrated cells are the two ends of that sequence — the gate, and
 * the confirmation. The middle two are text, because a signature and a
 * broadcast do not have a picture that says anything a sentence does not.
 */

type Step = Readonly<{
  index: string;
  title: string;
  body: string;
  wire: string;
}>;

const STEPS: readonly Step[] = [
  {
    index: "01",
    title: "The endpoint answers with its price",
    body: "A request arrives with no payment. Instead of a 401 and a signup page, the resource replies with what it costs, on which chains, in which assets, and how long that price holds.",
    wire: "402 Payment Required · PAYMENT-REQUIRED",
  },
  {
    index: "02",
    title: "The payer signs one authorization",
    body: "An exact amount, in an asset it already holds, valid for a window derived from the quote lock. Not a session, not a subscription, not an allowance to be drained later.",
    wire: "EIP-3009 · PAYMENT-SIGNATURE",
  },
  {
    index: "03",
    title: "A facilitator exist to broadcasts",
    body: "Whoever broadcasts pays the gas. They cannot change the amount or the recipient, which is what makes a facilitator a broadcaster rather than a custodian.",
    wire: "verify · settle",
  },
  {
    index: "04",
    title: "The settlement is read back off the chain",
    body: "A facilitator saying it worked is a claim. Nothing advances until the transaction is found on the chain it names and matched to this payment — right token, right recipient, full amount.",
    wire: "200 OK · PAYMENT-RESPONSE",
  },
];

export function X402Gateway() {
  return (
    <Section id="x402">
      <Reveal>
        <Label>x402 gateway</Label>
      </Reveal>

      <div class="md:flex md:items-end md:justify-between md:gap-20">
        <Reveal delay={60}>
          <SectionHeading>Any endpoint, payable per call.</SectionHeading>
        </Reveal>
        <Reveal delay={120}>
          <Lede class="md:mb-3 md:max-w-[38ch]">
            Put one middleware in front of a handler and it becomes a machine-payable resource. No
            signup, no key issued, no invoice — and the merchant behind it is settled exactly as
            they always were.
          </Lede>
        </Reveal>
      </div>

      {/* Two illustrated cells: the gate, and the confirmation. */}
      <div class="mt-12 grid gap-px border-y border-line bg-line md:mt-16 md:grid-cols-2">
        <Reveal>
          <figure class="h-full bg-paper px-6 py-12 md:p-14">
            <div aria-hidden="true">
              <img
                src="/images/gated-endpoint.webp"
                alt=""
                loading="lazy"
                decoding="async"
                class="mx-auto h-auto w-full max-w-72"
              />
            </div>
            <figcaption class="mt-10 max-w-full text-sm leading-[1.7] text-slate">
              The same URL answers differently depending on what arrived with the request. Nothing
              about the handler changes.
            </figcaption>
          </figure>
        </Reveal>

        <Reveal delay={80}>
          <figure class="h-full bg-paper px-6 py-12 md:p-14">
            <div aria-hidden="true">
              <img
                src="/images/settlement-confirmed.webp"
                alt=""
                loading="lazy"
                decoding="async"
                class="mx-auto h-auto w-full max-w-72"
              />
            </div>
            <figcaption class="mt-10 max-w-full text-sm leading-[1.7] text-slate">
              A settlement is confirmed against the chain, never against the response that reported
              it. A spoofed callback settles nothing.
            </figcaption>
          </figure>
        </Reveal>
      </div>

      <ol class="mt-px grid gap-px border-b border-line bg-line md:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step, index) => (
          <Reveal key={step.index} delay={(index % 4) * 70}>
            <li class="flex h-full flex-col bg-paper px-6 py-8 md:p-10">
              <span class="label text-slate">{step.index}</span>
              <h3 class="mt-6 max-w-[20ch] text-[1.6rem] leading-[1.2] tracking-[-0.01em]">
                {step.title}
              </h3>
              <p class="mt-3 max-w-[36ch] flex-1 text-sm leading-[1.7] text-slate">{step.body}</p>
              <code class="mt-6 block text-[0.7rem] tracking-[0.02em] text-slate">{step.wire}</code>
            </li>
          </Reveal>
        ))}
      </ol>

      <Reveal delay={80}>
        <p class="mt-10 max-w-[62ch] text-sm leading-[1.7] text-slate">
          Built on the{" "}
          <a
            class="text-ink underline decoration-line underline-offset-4 transition-colors hover:decoration-ink"
            href="https://github.com/coinbase/x402"
            rel="noreferrer"
            target="_blank"
          >
            x402 protocol
          </a>
          . Today the <code class="text-ink">exact</code> scheme over EVM chains; the price a payer
          is offered is honoured for a window derived from the quote lock, never configured beside
          it.
        </p>
      </Reveal>
    </Section>
  );
}
