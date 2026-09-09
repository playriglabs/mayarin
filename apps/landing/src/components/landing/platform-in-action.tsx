import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { gsap, registerGsap, ScrollTrigger } from "../../lib/gsap.ts";
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
    title: "Every payment, all in one view",
    description: "Balances, payment status, and volume stay together from the first sale onward.",
    image: "/images/pitch-deck/mayarin-overview.png",
    alt: "Mayarin overview showing balance, recent payments, and payment volume",
    width: 3420,
    height: 2036,
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
    eyebrow: "Catalog",
    title: "Price products the way you sell",
    description: "Keep products, SKUs, and local prices ready for links, carts, and invoices.",
    image: "/images/pitch-deck/mayarin-catalog.png",
    alt: "Creating a catalog product in Mayarin",
    width: 3420,
    height: 2038,
  },
  {
    eyebrow: "Checkout",
    title: "A checkout your buyer finishes",
    description:
      "Share a link or embed the page — price, and payment methods are already wired in.",
    image: "/images/pitch-deck/mayarin-ui-checkout.png",
    alt: "Mayarin checkout page with order summary and payment methods",
    width: 3420,
    height: 2038,
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
    eyebrow: "Wallets",
    title: "Choose where funds can settle",
    description: "Connect or provision verified wallets and see which assets each network accepts.",
    image: "/images/pitch-deck/mayarin-wallet.png",
    alt: "Mayarin wallets and payment availability",
    width: 3420,
    height: 2034,
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

const PREVIEW_VIEWS = PLATFORM_VIEWS.filter((view) => view.contain !== true);

const reducedMotionBehavior = (): ScrollBehavior =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";

function ProductImage({ view }: { readonly view: PlatformView }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const swipeStart = useRef<number | null>(null);
  const initialPreviewIndex = Math.max(0, PREVIEW_VIEWS.indexOf(view));
  const [previewIndex, setPreviewIndex] = useState(initialPreviewIndex);
  const previewView = PREVIEW_VIEWS[previewIndex] ?? view;

  const movePreview = (direction: -1 | 1) => {
    setPreviewIndex((current) =>
      Math.max(0, Math.min(PREVIEW_VIEWS.length - 1, current + direction)),
    );
  };
  const open = () => {
    const element = dialog.current;
    if (!element) return;
    setPreviewIndex(initialPreviewIndex);
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
      <span class="relative grid h-[min(80%,18rem)] w-auto aspect-square place-items-center">
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
      <dialog
        ref={dialog}
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          movePreview(event.key === "ArrowLeft" ? -1 : 1);
        }}
        aria-label={`${previewView.alt} — zoomed preview`}
        class="fixed inset-0 m-0 h-dvh w-screen max-h-none max-w-none bg-transparent p-0 backdrop:bg-ink/70 backdrop:backdrop-blur-sm open:flex open:items-center open:justify-center"
      >
        <div
          class="flex max-h-[86dvh] max-w-[calc(100vw-7rem)] touch-pan-y items-center justify-center md:max-w-[calc(100vw-12rem)]"
          onPointerDown={(event) => {
            swipeStart.current = event.clientX;
          }}
          onPointerUp={(event) => {
            const start = swipeStart.current;
            swipeStart.current = null;
            if (start === null) return;
            const distance = event.clientX - start;
            if (Math.abs(distance) < 48) return;
            movePreview(distance < 0 ? 1 : -1);
          }}
          onPointerCancel={() => {
            swipeStart.current = null;
          }}
        >
          <img
            src={previewView.image}
            alt={previewView.alt}
            width={previewView.width}
            height={previewView.height}
            decoding="async"
            draggable={false}
            class="max-h-[86dvh] w-auto max-w-full rounded-lg object-contain shadow-2xl"
          />
        </div>
        <button
          type="button"
          aria-label="Previous preview image"
          disabled={previewIndex === 0}
          onClick={() => movePreview(-1)}
          class="absolute top-1/2 left-3 flex size-12 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-white/25 bg-black/45 text-white backdrop-blur-md transition-colors hover:border-white/60 hover:bg-white hover:text-ink disabled:cursor-default disabled:opacity-25 disabled:hover:border-white/25 disabled:hover:bg-black/45 disabled:hover:text-white md:left-8"
        >
          <ArrowRight class="size-5 rotate-180" />
        </button>
        <button
          type="button"
          aria-label="Next preview image"
          disabled={previewIndex === PREVIEW_VIEWS.length - 1}
          onClick={() => movePreview(1)}
          class="absolute top-1/2 right-3 flex size-12 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-white/25 bg-black/45 text-white backdrop-blur-md transition-colors hover:border-white/60 hover:bg-white hover:text-ink disabled:cursor-default disabled:opacity-25 disabled:hover:border-white/25 disabled:hover:bg-black/45 disabled:hover:text-white md:right-8"
        >
          <ArrowRight class="size-5" />
        </button>
      </dialog>
    </>
  );
}

export function PlatformInAction() {
  const section = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const platformTrigger = useRef<ScrollTrigger | null>(null);
  const activeIndex = useRef(0);
  const [position, setPosition] = useState({ index: 0, atStart: true, atEnd: false });

  const updatePosition = useCallback((index: number) => {
    const next = Math.max(0, Math.min(PLATFORM_VIEWS.length - 1, index));
    if (next === activeIndex.current) return;
    activeIndex.current = next;
    setPosition({
      index: next,
      atStart: next === 0,
      atEnd: next === PLATFORM_VIEWS.length - 1,
    });
  }, []);

  const move = useCallback((direction: -1 | 1) => {
    const element = track.current;
    const card = element?.querySelector<HTMLElement>("[data-platform-card]");
    if (!element || !card) return;

    const trigger = platformTrigger.current;
    if (trigger) {
      const next = Math.max(
        0,
        Math.min(PLATFORM_VIEWS.length - 1, activeIndex.current + direction),
      );
      const progress = next / (PLATFORM_VIEWS.length - 1);
      window.scrollTo({
        top: trigger.start + (trigger.end - trigger.start) * progress,
        behavior: reducedMotionBehavior(),
      });
      return;
    }

    const gap = Number.parseFloat(getComputedStyle(element).columnGap) || 20;
    element.scrollBy({
      left: direction * (card.getBoundingClientRect().width + gap),
      behavior: reducedMotionBehavior(),
    });
  }, []);

  useEffect(() => {
    const element = track.current;
    if (!element) return;
    let frame = 0;

    const measure = () => {
      frame = 0;
      if (platformTrigger.current) return;
      const card = element.querySelector<HTMLElement>("[data-platform-card]");
      if (!card) return;
      const gap = Number.parseFloat(getComputedStyle(element).columnGap) || 12;
      updatePosition(Math.round(element.scrollLeft / (card.getBoundingClientRect().width + gap)));
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
  }, [move, updatePosition]);

  useEffect(() => {
    const root = section.current;
    const element = track.current;
    if (!root || !element) return;
    registerGsap();

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const context = gsap.context(() => {
      if (!reducedMotion) {
        gsap
          .timeline({
            defaults: { ease: "expo.out" },
            scrollTrigger: { trigger: root, start: "top 78%", once: true },
          })
          .from("[data-platform-kicker]", { autoAlpha: 0, y: 16, duration: 0.6 })
          .from(
            "[data-platform-line]",
            { autoAlpha: 0, yPercent: 115, rotateX: -12, duration: 1.05, stagger: 0.1 },
            "-=0.35",
          )
          .from("[data-platform-copy]", { autoAlpha: 0, y: 28, duration: 0.85 }, "-=0.75")
          .from(
            element,
            { autoAlpha: 0, y: 52, clipPath: "inset(0 0 14% 0)", duration: 1.05 },
            "-=0.65",
          )
          .from("[data-platform-controls]", { autoAlpha: 0, y: 12, duration: 0.55 }, "-=0.45");
      }
    }, root);

    const media = gsap.matchMedia();
    media.add(
      "(min-width: 80rem) and (min-height: 48rem) and (prefers-reduced-motion: no-preference)",
      () => {
        const distance = () => Math.max(0, element.scrollWidth - element.clientWidth);
        const progressBar = root.querySelector<HTMLElement>("[data-platform-progress]");
        const tween = gsap.to(element, {
          scrollLeft: distance,
          ease: "none",
          scrollTrigger: {
            trigger: root,
            // The fixed navigation owns the first four rem of the viewport. Pin
            // below it so the kicker and first headline never sit underneath it
            // on short landscape screens.
            start: "top top+=64",
            end: () => `+=${Math.max(distance(), window.innerWidth * 1.5)}`,
            pin: true,
            pinSpacing: true,
            scrub: 0.8,
            anticipatePin: 1,
            invalidateOnRefresh: true,
            snap: {
              snapTo: 1 / (PLATFORM_VIEWS.length - 1),
              duration: { min: 0.15, max: 0.45 },
              delay: 0.08,
              ease: "power2.inOut",
            },
            onUpdate: (self) => {
              updatePosition(Math.round(self.progress * (PLATFORM_VIEWS.length - 1)));
              if (progressBar) gsap.set(progressBar, { scaleX: self.progress });
            },
          },
        });
        platformTrigger.current = tween.scrollTrigger ?? null;

        return () => {
          platformTrigger.current = null;
          element.scrollLeft = 0;
          if (progressBar) gsap.set(progressBar, { clearProps: "transform" });
          updatePosition(0);
        };
      },
    );

    const refresh = () => ScrollTrigger.refresh();
    const refreshFrame = window.requestAnimationFrame(refresh);
    document.fonts?.ready.then(refresh).catch(() => {});

    return () => {
      window.cancelAnimationFrame(refreshFrame);
      media.revert();
      context.revert();
    };
  }, [updatePosition]);

  return (
    <section
      ref={section}
      id="platform"
      data-platform-stage
      class="overflow-hidden bg-v2-mist py-20 md:py-28"
    >
      <div class="mx-auto grid w-full max-w-300 gap-8 px-6 md:px-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-end lg:gap-20">
        <div>
          <p data-platform-kicker class="mb-3 ml-1 text-[15px] font-medium text-forest">
            Mayarin platform
          </p>
          <h2 class="perspective-midrange">
            <span class="block overflow-hidden pb-[0.08em]">
              <span data-platform-line class="inline-block will-change-transform">
                See every payment.
              </span>
            </span>
            <span class="block overflow-hidden pb-[0.08em]">
              <span data-platform-line class="inline-block will-change-transform">
                Shape every flow.
              </span>
            </span>
          </h2>
        </div>
        <div>
          <p
            data-platform-copy
            class="max-w-135 text-base leading-relaxed text-slate-600 md:text-lg"
          >
            From a first payment link to final settlement, every step lives in one operating
            surface. Your customers pay their way while your business keeps one clear view.
          </p>
        </div>
      </div>

      <div data-platform-carousel class="mt-12 md:mt-16">
        <section
          ref={track}
          id="platform-track"
          aria-roledescription="carousel"
          aria-label="Mayarin product screens. Swipe or use the left and right arrow keys to explore."
          // biome-ignore lint/a11y/noNoninteractiveTabindex: The scrollable carousel supports keyboard navigation.
          tabIndex={0}
          data-lenis-prevent-horizontal
          class="grid snap-x mt-6 snap-mandatory auto-cols-[min(84vw,28rem)] grid-flow-col gap-3 overflow-x-auto overscroll-x-contain px-6 outline-offset-4 scrollbar-none md:px-10 [&::-webkit-scrollbar]:hidden"
        >
          {PLATFORM_VIEWS.map((view) => (
            <article
              key={view.title}
              data-platform-card
              class="flex min-h-130 snap-start flex-col overflow-hidden rounded-3xl border border-line bg-paper/60"
            >
              <div
                data-platform-media
                class="flex h-82 items-center justify-center overflow-hidden border-b border-line bg-paper"
              >
                <ProductImage view={view} />
              </div>
              <div class="flex flex-1 flex-col p-7 md:p-8">
                <p class="font-sans text-sm text-forest">{view.eyebrow}</p>
                <h4 class="mt-5 font-sans text-[1.75rem] md:text-[2rem]">{view.title}</h4>
                <p class="mt-4 max-w-[38ch] text-[15px] leading-relaxed text-slate-600">
                  {view.description}
                </p>
              </div>
            </article>
          ))}
        </section>
      </div>

      <div
        data-platform-controls
        class="mx-auto mt-8 flex w-full max-w-300 items-center gap-6 px-6 md:px-10"
      >
        <div aria-hidden="true" class="h-px flex-1 overflow-hidden bg-line">
          <span data-platform-progress class="block h-full origin-left bg-forest" />
        </div>
        <div class="flex shrink-0 gap-2">
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
