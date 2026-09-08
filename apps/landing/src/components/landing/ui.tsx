import clsx from "clsx";
import type { ComponentChildren } from "preact";
import { useRef } from "preact/hooks";
import { ArrowRight } from "../ui.tsx";

export function Action({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ComponentChildren;
}) {
  return (
    <a
      href={href}
      class="inline-flex size-12 shrink-0 items-center justify-center gap-3 rounded-full bg-ink p-0 text-sm font-medium text-white transition-colors duration-200 hover:bg-forest sm:size-auto sm:min-h-12 sm:px-6 sm:py-3"
    >
      <span class="sr-only sm:not-sr-only">{children}</span>
      <ArrowRight />
    </a>
  );
}

export function SectionIntro({
  label,
  title,
  children,
  centered = true,
}: {
  readonly label?: string;
  readonly title: ComponentChildren;
  readonly children?: ComponentChildren;
  readonly centered?: boolean;
}) {
  return (
    <div
      class={clsx("max-w-180 [&.text-center]:mx-auto [&_h2_span]:text-forest", {
        "text-center": centered,
      })}
    >
      <p class="mb-5 text-xs font-medium tracking-[0.08em] text-forest">{label}</p>
      <h2>{title}</h2>
      {children && (
        <p class="mt-6 max-w-135 text-base leading-relaxed text-slate-600 md:text-lg in-[[class*=text-center]]:mx-auto">
          {children}
        </p>
      )}
    </div>
  );
}

/**
 * A full-viewport zoom for the capture. `<dialog>` gives the top layer, the
 * Escape key and the focus trap for free, matching the pattern in
 * `capabilities.tsx` — and any click dismisses, which is all a lightbox needs.
 */
export function DashboardPreview({
  src,
  alt = "Mayarin merchant dashboard",
}: {
  readonly src?: string;
  readonly alt?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  const open = () => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    // Lenis keeps scrolling the page underneath otherwise.
    document.documentElement.style.overflow = "hidden";
    dialog.addEventListener(
      "close",
      () => {
        document.documentElement.style.overflow = "";
      },
      { once: true },
    );
  };

  return (
    <div class="overflow-hidden rounded-t-xl border border-line bg-paper shadow-[0_0_0_8px_#ffffff66,0_0_60px_#1f6f5410] md:rounded-t-2xl">
      <div
        class="flex h-9 items-center gap-1.5 border-b border-line/60 bg-v2-mist/40 px-4 [&>span]:size-1.5 [&>span]:rounded-full [&>i]:mx-auto [&>i]:h-3 [&>i]:w-32 [&>i]:rounded-sm [&>i]:bg-ink/3"
        aria-hidden="true"
      >
        <span class="bg-red-400/80" />
        <span class="bg-ink/25" />
        <span class="bg-forest/60" />
        <i />
      </div>
      {src ? (
        <>
          <button
            type="button"
            onClick={open}
            aria-label={`${alt} — click to zoom`}
            class="block w-full cursor-zoom-in"
          >
            <img
              src={src}
              alt={alt}
              width="1440"
              height="900"
              class="block aspect-video w-full object-cover object-top"
            />
          </button>
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: Escape is native to <dialog>; clicking anywhere is a pointer-only shortcut on top of it. */}
          <dialog
            ref={ref}
            onClick={() => ref.current?.close()}
            aria-label={`${alt} — zoomed`}
            class="fixed inset-0 m-0 h-dvh w-screen max-h-none max-w-none bg-transparent p-0 backdrop:bg-ink/70 backdrop:backdrop-blur-sm open:flex open:items-center open:justify-center"
          >
            <img
              src={src}
              alt={alt}
              width="1440"
              height="900"
              class="max-h-[86dvh] w-auto max-w-[94vw] rounded-lg shadow-2xl"
            />
          </dialog>
        </>
      ) : (
        <div
          class="aspect-16/7 w-full bg-paper"
          role="img"
          aria-label="Dashboard preview space reserved for a product screenshot"
        />
      )}
    </div>
  );
}

export function Check() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      aria-hidden="true"
    >
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}
