import clsx from "clsx";

const MARK_ASSETS = [
  {
    index: "01",
    label: "Primary mark",
    file: "mayarin-logo-black.svg",
    surface: "bg-[#f1f1ee]",
    imageClass: "max-h-72",
    description: "The mark for light surfaces and quiet applications.",
  },
  {
    index: "02",
    label: "Reversed mark",
    file: "mayarin-logo-white.svg",
    surface: "bg-ink",
    imageClass: "max-h-72",
    description: "The mark for dark surfaces and high-contrast moments.",
  },
  {
    index: "03",
    label: "Mayarin green",
    file: "mayarin-green.png",
    surface: "bg-accent",
    imageClass: "max-h-72",
    description: "The accent mark for moments that need a clear signal.",
  },
] as const;

type BrandKitAsset = (typeof MARK_ASSETS)[number];

const BRAND_KIT_PATH = "/brand-kit";

function DownloadIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      aria-hidden="true"
      class="size-4 shrink-0"
    >
      <path d="M8 2.5v8M4.5 7.5 8 11l3.5-3.5M2.5 11.5v2h11v-2" stroke-linecap="square" />
    </svg>
  );
}

function DownloadLink({ file }: { file: string }) {
  return (
    <a
      href={`${BRAND_KIT_PATH}/${file}`}
      download
      class="label inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-slate transition-colors duration-200 hover:text-forest"
    >
      <span>Download PNG</span>
      <DownloadIcon />
    </a>
  );
}

function AssetCard({ index, label, file, surface, imageClass, description }: BrandKitAsset) {
  return (
    <article>
      <div
        class={clsx(
          "flex min-h-72 items-center justify-center rounded-xl p-8 md:min-h-96 md:p-12",
          surface,
        )}
      >
        <img
          src={`${BRAND_KIT_PATH}/${file}`}
          alt={`Mayarin ${label.toLowerCase()}`}
          class={clsx("h-auto w-auto object-contain", imageClass)}
        />
      </div>
      <div class="mt-4 flex items-start justify-between gap-6">
        <div>
          <p class="label text-slate">
            {index} · {label}
          </p>
          <p class="mt-3 max-w-[34ch] text-sm leading-6 text-slate">{description}</p>
        </div>
        <DownloadLink file={file} />
      </div>
    </article>
  );
}

export function BrandKit() {
  return (
    <main class="min-h-screen bg-paper text-ink">
      <section class="shell pt-16 pb-20 md:pt-20 md:pb-28">
        <p class="label text-slate">/mayarin/ · visual system</p>
        <h1 class="mt-8 max-w-[13ch] text-[clamp(4rem,9vw,8.5rem)] leading-[0.88]">
          Built for value in motion.
        </h1>
        <p class="mt-10 max-w-[58ch] text-lg leading-[1.65] text-slate md:text-xl">
          A compact set of marks for the infrastructure that moves money across assets, chains and
          borders. Use the files below as the starting point for Mayarin communications and product
          surfaces.
        </p>
      </section>

      <section class="shell pb-24 md:pb-36" aria-labelledby="marks-heading">
        <div class="mb-10 flex items-end justify-between gap-6 border-b border-line pb-5">
          <p id="marks-heading" class="text-xs font-medium tracking-[0.16em] uppercase">
            Core identifiers
          </p>
          <span class="label hidden text-slate sm:block">SVG and PNG · transparent</span>
        </div>

        <div class="grid gap-x-8 gap-y-16 md:grid-cols-3 md:gap-y-24">
          {MARK_ASSETS.map((asset) => (
            <AssetCard key={asset.file} {...asset} />
          ))}
        </div>

        <p class="mt-24 border-b border-line pb-5 text-xs font-medium tracking-[0.16em] uppercase md:mt-36">
          Lockup
        </p>
        <div class="mt-10 grid gap-10 md:grid-cols-[1fr_1fr] md:gap-16">
          <div class="flex min-h-56 items-center justify-center rounded-sm bg-[#f1f1ee] p-10">
            <span class="flex items-center text-[clamp(2rem,4vw,3rem)] leading-none tracking-[-0.06em] text-ink">
              <img
                src="/brand-kit/mayarin-logo-black.svg"
                alt=""
                aria-hidden="true"
                width="96"
                height="96"
                class="size-[1.4em]"
              />
              <span class="ml-[-0.06em] font-sans font-medium">mayarin</span>
            </span>
          </div>
          <div class="self-center">
            <p class="text-lg leading-[1.7] text-slate">
              There is no lockup file. The lockup is the mark set beside the name in Geist at medium
              weight, optically kerned so the wordmark tucks under the mark's overhang. Building it
              from the two parts keeps one source of truth for the mark and lets the name inherit
              whatever text colour it sits in.
            </p>
          </div>
        </div>
      </section>

      <section class="bg-void text-white">
        <div class="shell grid gap-12 py-20 md:grid-cols-[1fr_1.5fr] md:py-28">
          <div>
            <p class="label text-slate-inverse">Usage</p>
            <h2 class="mt-7 max-w-[11ch] text-[clamp(3rem,6vw,5.5rem)] leading-[0.9]">
              Keep it clear.
            </h2>
          </div>
          <div class="max-w-xl text-lg leading-[1.7] text-slate-inverse">
            <p>
              Give the mark room to work. Prefer the black mark on light surfaces and the white mark
              on dark surfaces. Do not stretch, rotate, recolour or place the mark over noisy
              imagery.
            </p>
            <a
              href="mailto:hello@mayarin.xyz"
              class="mt-8 inline-flex border-b border-white/40 pb-1 text-sm text-white transition-colors hover:border-white"
            >
              Questions about the brand? Say hello ↗
            </a>
          </div>
        </div>
      </section>

      <footer class="shell flex flex-col gap-4 py-8 text-sm text-slate sm:flex-row sm:items-center sm:justify-between">
        <span>© {new Date().getFullYear()} Mayarin</span>
        <a href="/" class="text-slate transition-colors hover:text-forest">
          mayarin.xyz
        </a>
      </footer>
    </main>
  );
}
