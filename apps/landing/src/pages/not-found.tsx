import { GridField } from "../graphics/grid-field.tsx";

export function NotFound() {
  return (
    <main class="relative flex h-screen items-center overflow-hidden bg-paper text-ink">
      <GridField tone="light" />

      <div class="shell pointer-events-none relative z-2 w-full py-16 md:py-24">
        <a href="/" aria-label="Mayarin home" class="pointer-events-auto inline-flex">
          <img
            src="/brand-kit/mayarin-logo-black.png"
            alt="Mayarin"
            width="48"
            height="48"
            class="size-12"
          />
        </a>

        <div class="mt-20 max-w-2xl md:mt-32">
          <p class="label text-slate">404 — route not found</p>
          <h1 class="mt-7 max-w-[11ch] text-[clamp(4rem,9vw,8rem)] leading-[0.88]">
            This path went off the rails.
          </h1>
          <p class="mt-8 max-w-[42ch] text-lg leading-[1.65] text-slate">
            The page you requested does not exist, or it has moved somewhere else in the network.
          </p>
          <div class="pointer-events-auto mt-10 flex flex-wrap gap-3">
            <a
              href="/"
              class="inline-flex h-12 items-center bg-ink px-7 text-sm font-medium text-white transition-colors hover:bg-forest"
            >
              Back to Mayarin
            </a>
            <a
              href="/brand-kit/"
              class="inline-flex h-12 items-center border border-line px-7 text-sm font-medium transition-colors hover:border-ink"
            >
              Visit brand kit
            </a>
          </div>
        </div>

        <div class="mt-20 md:mt-32">
          <p class="label text-slate">Money moves · Infrastructure orchestrates</p>
        </div>
      </div>
    </main>
  );
}
