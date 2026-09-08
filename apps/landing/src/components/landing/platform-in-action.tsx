import { useEffect, useRef, useState } from "preact/hooks";
import { Reveal } from "../reveal.tsx";
import { ArrowRight } from "../ui.tsx";

interface PlatformView {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly image: string;
  readonly alt: string;
  readonly width: number;
  readonly height: number;
  readonly contain?: boolean;
}

const PLATFORM_VIEWS: readonly PlatformView[] = [
  {
    eyebrow: "Control center",
    title: "Every payment, in one view",
    description: "Balances, payment status, and volume stay together from the first sale onward.",
    image: "/images/pitch-deck/mayarin-overview.png",
    alt: "Mayarin overview showing balance, recent payments, and payment volume",
    width: 3420,
    height: 2036,
  },
  {
    eyebrow: "Analytics",
    title: "Know what drives payment performance",
    description: "Read volume, outcomes, and completion time across pay-ins and payouts.",
    image: "/images/pitch-deck/mayarin-analytics.png",
    alt: "Mayarin analytics showing payment volume, status, and completion time",
    width: 3420,
    height: 2034,
  },
  {
    eyebrow: "Payment links",
    title: "Turn one link into every sale",
    description: "Share a checkout once and give every buyer a fresh payment of their own.",
    image: "/images/pitch-deck/mayarin-payment-links.png",
    alt: "Mayarin payment links dashboard",
    width: 3420,
    height: 1998,
  },
  {
    eyebrow: "Counter payments",
    title: "Put a branded QR at the counter",
    description: "Let customers scan and pay while every transaction remains individually tracked.",
    image: "/images/pitch-deck/mayarin-qr.png",
    alt: "Mayarin branded payment QR code",
    width: 1200,
    height: 1200,
    contain: true,
  },
  {
    eyebrow: "Invoices",
    title: "Issue invoices in local currency",
    description:
      "Price the work as usual, then let the client choose a supported asset at checkout.",
    image: "/images/pitch-deck/mayarin-invoice.png",
    alt: "Generating an invoice in Mayarin",
    width: 3392,
    height: 1966,
  },
  {
    eyebrow: "Catalog",
    title: "Price products the way you sell",
    description: "Keep products, SKUs, and local prices ready for links, carts, and invoices.",
    image: "/images/pitch-deck/mayarin-catalog.png",
    alt: "Creating a catalog product in Mayarin",
    width: 3420,
    height: 2038,
  },
  {
    eyebrow: "Wallets",
    title: "Choose where funds settle",
    description: "Connect or provision verified wallets and see which assets each network accepts.",
    image: "/images/pitch-deck/mayarin-wallet.png",
    alt: "Mayarin wallets and payment availability",
    width: 3420,
    height: 2034,
  },
  {
    eyebrow: "Settlement",
    title: "Reconcile what actually landed",
    description:
      "Follow net amounts, fees, networks, and references through one settlement record.",
    image: "/images/pitch-deck/mayarin-settlement.png",
    alt: "Mayarin settlement dashboard",
    width: 3420,
    height: 2038,
  },
  {
    eyebrow: "Agent payments",
    title: "Charge software per request",
    description: "Publish x402 resources that autonomous agents can discover and pay for directly.",
    image: "/images/pitch-deck/mayarin-x402.png",
    alt: "Mayarin x402 agent endpoints",
    width: 3420,
    height: 2036,
  },
] as const;

const reducedMotionBehavior = (): ScrollBehavior =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";

function ProductImage({ view }: { readonly view: PlatformView }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const open = () => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    document.documentElement.style.overflow = "hidden";
    element.addEventListener(
      "close",
      () => {
        document.documentElement.style.overflow = "";
      },
      { once: true },
    );
  };
  const image = (
    <img
      src={view.image}
      alt={view.alt}
      width={view.width}
      height={view.height}
      loading="lazy"
      decoding="async"
      draggable={false}
      class={
        view.contain === true ? "size-[78%] object-contain" : "size-full object-cover object-center"
      }
    />
  );

  const thumbnail =
    view.contain === true ? (
      <span class="relative grid size-[min(80%,18rem)] place-items-center">
        <span
          aria-hidden="true"
          class="absolute top-0 left-0 size-10 rounded-tl-2xl border-t-2 border-l-2 border-forest/35"
        />
        <span
          aria-hidden="true"
          class="absolute top-0 right-0 size-10 rounded-tr-2xl border-t-2 border-r-2 border-forest/35"
        />
        <span
          aria-hidden="true"
          class="absolute bottom-0 left-0 size-10 rounded-bl-2xl border-b-2 border-l-2 border-forest/35"
        />
        <span
          aria-hidden="true"
          class="absolute right-0 bottom-0 size-10 rounded-br-2xl border-r-2 border-b-2 border-forest/35"
        />
        {image}
      </span>
    ) : (
      image
    );

  if (view.contain === true) return thumbnail;

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-label={`${view.alt} — click to zoom`}
        class="flex size-full cursor-zoom-in items-center justify-center"
      >
        {thumbnail}
      </button>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: Escape is native to <dialog>; clicking anywhere is a pointer-only shortcut on top of it. */}
      <dialog
        ref={dialog}
        onClick={() => dialog.current?.close()}
        aria-label={`${view.alt} — zoomed`}
        class="fixed inset-0 m-0 h-dvh w-screen max-h-none max-w-none bg-transparent p-0 backdrop:bg-ink/70 backdrop:backdrop-blur-sm open:flex open:items-center open:justify-center"
      >
        <img
          src={view.image}
          alt={view.alt}
          width={view.width}
          height={view.height}
          class="max-h-[86dvh] w-auto max-w-[94vw] rounded-lg object-contain shadow-2xl"
        />
      </dialog>
    </>
  );
}

export function PlatformInAction() {
  const track = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ atStart: true, atEnd: false });

  const move = (direction: -1 | 1) => {
    const element = track.current;
    const card = element?.querySelector<HTMLElement>("[data-platform-card]");
    if (!element || !card) return;
    const gap = Number.parseFloat(getComputedStyle(element).columnGap) || 20;
    element.scrollBy({
      left: direction * (card.getBoundingClientRect().width + gap),
      behavior: reducedMotionBehavior(),
    });
  };

  useEffect(() => {
    const element = track.current;
    if (!element) return;
    let frame = 0;

    const measure = () => {
      frame = 0;
      setPosition({
        atStart: element.scrollLeft <= 2,
        atEnd: element.scrollLeft >= element.scrollWidth - element.clientWidth - 2,
      });
    };
    const scheduleMeasure = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      move(event.key === "ArrowLeft" ? -1 : 1);
    };

    element.addEventListener("scroll", scheduleMeasure, { passive: true });
    element.addEventListener("keydown", keyDown);
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(element);
    measure();
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      element.removeEventListener("scroll", scheduleMeasure);
      element.removeEventListener("keydown", keyDown);
    };
  }, []);

  return (
    <section id="platform" class="overflow-hidden bg-v2-mist py-20 md:py-28">
      <div class="mx-auto grid w-full max-w-300 gap-8 px-6 md:px-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-end lg:gap-20">
        <Reveal>
          <p class="text-sm mb-4 font-medium text-forest">Mayarin platform</p>
          <h2>
            See every payment.
            <br />
            Shape every flow.
          </h2>
        </Reveal>
        <Reveal delay={100}>
          <p class="max-w-135 text-base leading-relaxed text-slate md:text-lg">
            From a first payment link to final settlement, every step lives in one operating
            surface. Your customers pay their way while your business keeps one clear view.
          </p>
        </Reveal>
      </div>

      <Reveal delay={160} class="mt-14 md:mt-18">
        <section
          ref={track}
          id="platform-track"
          aria-roledescription="carousel"
          aria-label="Mayarin product screens. Swipe or use the left and right arrow keys to explore."
          // biome-ignore lint/a11y/noNoninteractiveTabindex: The scrollable carousel supports keyboard navigation.
          tabIndex={0}
          data-lenis-prevent-horizontal
          class="grid snap-x snap-mandatory auto-cols-[min(84vw,28rem)] grid-flow-col gap-5 overflow-x-auto overscroll-x-contain px-6 outline-offset-4 scrollbar-none md:px-10 [&::-webkit-scrollbar]:hidden"
        >
          {PLATFORM_VIEWS.map((view) => (
            <article
              key={view.title}
              data-platform-card
              class="flex min-h-130 snap-start flex-col overflow-hidden rounded-3xl border border-line bg-paper/60"
            >
              <div class="flex h-82 items-center justify-center overflow-hidden border-b border-line bg-paper">
                <ProductImage view={view} />
              </div>
              <div class="flex flex-1 flex-col p-7 md:p-8">
                <p class="font-sans text-sm text-forest">{view.eyebrow}</p>
                <h4 class="mt-5 font-sans text-[1.75rem] md:text-[2rem]">{view.title}</h4>
                <p class="mt-4 max-w-[38ch] text-[15px] leading-relaxed text-slate">
                  {view.description}
                </p>
              </div>
            </article>
          ))}
        </section>
      </Reveal>

      <div class="mx-auto mt-8 flex w-full max-w-300 justify-end px-6 md:px-10">
        <div class="flex gap-2">
          <button
            type="button"
            aria-label="Previous platform view"
            aria-controls="platform-track"
            disabled={position.atStart}
            onClick={() => move(-1)}
            class="flex size-11 cursor-pointer items-center justify-center rounded-full border border-line bg-paper/60 transition-colors hover:border-forest hover:text-forest disabled:cursor-default disabled:opacity-30"
          >
            <ArrowRight class="size-4 rotate-180" />
          </button>
          <button
            type="button"
            aria-label="Next platform view"
            aria-controls="platform-track"
            disabled={position.atEnd}
            onClick={() => move(1)}
            class="flex size-11 cursor-pointer items-center justify-center rounded-full border border-line bg-paper/60 transition-colors hover:border-forest hover:text-forest disabled:cursor-default disabled:opacity-30"
          >
            <ArrowRight class="size-4" />
          </button>
        </div>
      </div>
    </section>
  );
}
