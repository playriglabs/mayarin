import { Reveal } from "../reveal.tsx";

function Chevron() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function EarlyAccessCta() {
  return (
    <section class="relative isolate flex min-h-128 items-center overflow-hidden border-y border-white/15 bg-plate py-20 text-paper md:py-28">
      <svg
        aria-hidden="true"
        class="pointer-events-none absolute inset-0 hidden size-full text-accent/50 md:block"
        fill="none"
        preserveAspectRatio="none"
        viewBox="0 0 1600 560"
      >
        <defs>
          <pattern
            height="18"
            id="early-access-hatch"
            patternTransform="rotate(45)"
            patternUnits="userSpaceOnUse"
            width="18"
          >
            <line stroke="currentColor" strokeWidth="2" x1="0" x2="0" y1="0" y2="18" />
          </pattern>
        </defs>
        <path d="M0 0H150V176H0" stroke="currentColor" />
        <rect
          fill="url(#early-access-hatch)"
          height="176"
          stroke="currentColor"
          width="150"
          x="0"
          y="176"
        />
        <path d="M1450 0V176H1600" stroke="currentColor" />
        <path d="M1450 0H1600" stroke="currentColor" />
        <path d="M0 520H280V560" stroke="currentColor" />
        <path d="M1320 560V520H1600" stroke="currentColor" />
      </svg>

      <Reveal class="relative z-10 mx-auto flex w-full max-w-5xl flex-col items-center px-5 text-center sm:px-8">
        <p class="text-sm mb-5 text-accent">Get early access</p>
        <h2 class="max-w-4xl text-balance text-paper">
          Focus on building. Let Mayarin move the money.
        </h2>
        <p class="mt-8 max-w-3xl text-balance text-base leading-7 text-white/65 md:text-lg">
          Accept, route, and settle payments through one integration built to grow with your
          product.
        </p>
        <a
          class="mt-9 inline-flex min-h-12 gap-1.5 items-center justify-center rounded-full bg-accent px-6 py-2 font-medium text-plate transition-colors hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
          href="#footer-early-access"
        >
          Get early access
          <Chevron />
        </a>
      </Reveal>
    </section>
  );
}
