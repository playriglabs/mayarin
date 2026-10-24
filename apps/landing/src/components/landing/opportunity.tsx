import { Reveal } from "../reveal.tsx";

export function Opportunity() {
  return (
    <section id="opportunity" aria-labelledby="opportunity-title" class="bg-v2-mist">
      <div class="mx-auto w-full max-w-300 border-x border-line px-6 py-20 md:px-10 md:py-28">
        <Reveal class="mx-auto max-w-250">
          <p class="flex items-center gap-3 text-sm font-semibold text-brand">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="shrink-0"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <ellipse cx="12" cy="12" rx="4" ry="9" />
              <path d="M3 12h18" />
            </svg>
            The opportunity
          </p>
          <h2
            id="opportunity-title"
            class="mt-8 max-w-220 text-pretty font-medium text-[clamp(1.5rem,2.5vw,2rem)]! leading-tight! tracking-[-0.035em]! md:mt-10"
          >
            Your business can reach the world. <br />
            Your payments should be able to keep up.
          </h2>
          <div class="mt-9 grid gap-6 text-sm leading-relaxed text-slate-600 md:mt-12 md:grid-cols-2 md:gap-12 md:text-base">
            <p>
              Every new market brings new currencies, payment preferences, and ways to move money.
              Connecting separate systems and tracking every payment adds work at the exact moment
              your business is ready to grow.
            </p>
            <p>
              Mayarin brings payment collection, conversion, and stablecoin settlement into one
              integration. Price in your local currency, let customers pay with supported assets,
              and manage payments in one place, from your first sale to your next market.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
