import { type Snippet, snippets } from "virtual:code-snippets";
import { Reveal } from "../reveal.tsx";
import { LanguageMark } from "./language-mark.tsx";
import { SectionIntro } from "./ui.tsx";

const DOCS_URL = "https://docs.mayarin.xyz";
const DASHBOARD_URL = "https://dashboard-testnet.mayarin.xyz/login";

const SDK_SNIPPET = snippets.find((snippet) => snippet.id === "sdk-intent");

interface Link {
  readonly label: string;
  readonly href: string;
}

interface Tile {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly primary: Link;
  readonly secondary: Link;
  readonly surface: string;
  readonly visual:
    | { readonly kind: "code" }
    | {
        readonly kind: "screen";
        readonly src: string;
        readonly alt: string;
        /** A charcoal bezel, for a screenshot that is itself dark: black would vanish into it. */
        readonly darkScreen?: true;
        /** A second image laid over the frame's bottom right corner. */
        readonly overlay?: { readonly src: string; readonly alt: string };
      };
}

const TILES: readonly Tile[] = [
  {
    eyebrow: "APIs & SDKs",
    title: "Developer Toolkit",
    description:
      "A typed TypeScript SDK or plain HTTP to create payments, links and invoices, with signed webhooks when money lands.",
    primary: { label: "Read docs", href: `${DOCS_URL}/guides/api-quickstart` },
    secondary: { label: "Learn more", href: `${DOCS_URL}/sdk/typescript` },
    surface: "bg-v2-mist",
    visual: { kind: "code" },
  },
  {
    eyebrow: "Self-serve",
    title: "Dashboard",
    description:
      "Take payments, track settlements and manage your business from one portal. No code required.",
    primary: { label: "Get access", href: DASHBOARD_URL },
    secondary: { label: "Learn more", href: DOCS_URL },
    surface: "bg-paper",
    visual: {
      kind: "screen",
      src: "/images/product/dashboard-overview.png",
      alt: "The Mayarin dashboard overview",
    },
  },
  {
    eyebrow: "Insights",
    title: "Analytics",
    description:
      "Revenue, conversion, time to pay and success rate per network, in the dashboard and from the API.",
    primary: { label: "Read the guide", href: `${DOCS_URL}/guides/analytics` },
    secondary: { label: "API reference", href: `${DOCS_URL}/api-reference` },
    surface: "bg-paper",
    visual: {
      kind: "screen",
      src: "/images/product/analytics-overview.png",
      alt: "The Mayarin analytics page",
    },
  },
  {
    eyebrow: "Hosted checkout",
    title: "Checkout",
    description:
      "A hosted page and a QR for every payment, priced in your currency and paid with whatever the payer brings.",
    primary: { label: "Get access", href: DASHBOARD_URL },
    secondary: { label: "Learn more", href: `${DOCS_URL}/sdk/typescript/payments` },
    surface: "bg-paper",
    visual: {
      kind: "screen",
      src: "/images/product/checkout-preview.png",
      alt: "The Mayarin hosted checkout",
      darkScreen: true,
      overlay: { src: "/images/product/qr-overview.png", alt: "A Mayarin payment QR code" },
    },
  },
];

/** The example in a window that the tile clips at its bottom edge. */
function CodeWindow({ snippet }: { readonly snippet: Snippet }) {
  return (
    <div class="mx-auto mt-12 flex min-h-80 w-full max-w-3xl flex-1 flex-col overflow-hidden rounded-t-2xl bg-code-panel text-left md:w-[72%]">
      <div class="flex items-center gap-3 border-b border-line-inverse px-5 py-3.5">
        <LanguageMark lang={snippet.lang} />
        <span class="font-sans text-[13px] text-slate-inverse">{snippet.filename}</span>
      </div>
      {/* The code is laid out absolutely so its length never sets the row's height:
          the screenshot beside it does, and the code is cropped to fit. */}
      <div class="relative min-h-0 flex-1">
        <div
          class="code-surface absolute inset-0 overflow-hidden"
          dangerouslySetInnerHTML={{ __html: snippet.html }}
        />
      </div>
    </div>
  );
}

function ScreenVisual({
  src,
  alt,
  overlay,
  darkScreen,
}: {
  readonly src: string;
  readonly alt: string;
  readonly darkScreen?: true | undefined;
  readonly overlay?: { readonly src: string; readonly alt: string } | undefined;
}) {
  return (
    <div class="relative mx-auto mt-12 w-full max-w-3xl md:w-[86%]">
      <div
        class={`overflow-hidden rounded-t-3xl border-x-8 border-t-8 bg-paper ${darkScreen ? "border-[#9ca3af]" : "border-ink"}`}
      >
        <img
          src={src}
          alt={alt}
          width="1440"
          height="900"
          loading="lazy"
          decoding="async"
          class="block h-auto w-full"
        />
      </div>
      {overlay && (
        <img
          src={overlay.src}
          alt={overlay.alt}
          width="176"
          height="176"
          loading="lazy"
          decoding="async"
          class="absolute right-4 bottom-0 w-28 rounded-t-2xl bg-paper p-3 shadow-xl md:right-8 md:w-44"
        />
      )}
    </div>
  );
}

function TileCard({ tile }: { readonly tile: Tile }) {
  return (
    <article
      class={`flex flex-col overflow-hidden px-7 pt-14 text-center ${tile.surface} text-ink`}
    >
      <p class={`text-sm font-medium uppercase text-slate-600`}>{tile.eyebrow}</p>
      <h4 class="mt-4 font-sans text-[clamp(2rem,2.8vw,2.5rem)] leading-tight">{tile.title}</h4>
      <p class={`mx-auto mt-4 max-w-[44ch] text-base leading-relaxed md:text-lg text-slate-600`}>
        {tile.description}
      </p>
      <div class="mt-7 flex items-center justify-center gap-3">
        <a
          href={tile.primary.href}
          class="inline-flex min-h-11 items-center rounded-lg bg-brand px-5 text-base font-medium text-white transition-colors hover:bg-brand/85"
        >
          {tile.primary.label}
        </a>
        <a
          href={tile.secondary.href}
          class="inline-flex min-h-11 items-center rounded-lg border border-line bg-paper px-5 text-base font-medium text-ink transition-colors hover:border-brand hover:text-brand"
        >
          {tile.secondary.label}
        </a>
      </div>
      {tile.visual.kind === "code" && SDK_SNIPPET && <CodeWindow snippet={SDK_SNIPPET} />}
      {tile.visual.kind === "screen" && (
        <ScreenVisual
          src={tile.visual.src}
          alt={tile.visual.alt}
          overlay={tile.visual.overlay}
          darkScreen={tile.visual.darkScreen}
        />
      )}
    </article>
  );
}

/** Four products in a 2 by 2 grid; each tile clips its visual at the bottom edge. */
export function Developers() {
  return (
    <section id="developers" class="w-full py-20 md:py-28">
      <Reveal class="mx-auto max-w-300 px-5 md:px-10">
        <SectionIntro
          label="For developers"
          title={
            <>
              Built for Developers,
              <span>
                <br />
                Scaling their payment.
              </span>
            </>
          }
        >
          <p className="text-center">
            Integrate in hours using modern APIs and SDKs, with all the tools you need to launch
            smoothly.
          </p>
        </SectionIntro>
      </Reveal>

      <div class="mt-14 grid gap-px bg-line md:mt-20 md:grid-cols-2">
        {TILES.map((tile) => (
          <TileCard key={tile.title} tile={tile} />
        ))}
      </div>
    </section>
  );
}
