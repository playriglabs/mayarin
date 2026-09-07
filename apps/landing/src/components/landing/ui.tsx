import clsx from "clsx";
import type { ComponentChildren } from "preact";
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
      class="inline-flex min-h-12 items-center justify-center gap-3 rounded-full bg-ink px-6 py-3 text-sm font-medium text-white transition-colors duration-200 hover:bg-forest"
    >
      {children}
      <ArrowRight class="hidden sm:block" />
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
        <p class="mt-6 max-w-135 text-base leading-relaxed text-slate md:text-lg in-[[class*=text-center]]:mx-auto">
          {children}
        </p>
      )}
    </div>
  );
}

/** Supply the real dashboard capture here when it is ready. The empty state is intentional. */
export function DashboardPreview({
  src,
  alt = "Mayarin merchant dashboard",
}: {
  readonly src?: string;
  readonly alt?: string;
}) {
  return (
    <div class="overflow-hidden rounded-t-xl border border-line bg-paper shadow-[0_0_0_8px_#ffffff66,0_0_60px_#1f6f5410] md:rounded-t-2xl">
      <div
        class="flex h-9 items-center gap-1.5 border-b border-line/60 bg-v2-mist/40 px-4 [&>span]:size-1.5 [&>span]:rounded-full [&>span]:bg-ink/15 [&>i]:mx-auto [&>i]:h-3 [&>i]:w-32 [&>i]:rounded-sm [&>i]:bg-ink/3"
        aria-hidden="true"
      >
        <span />
        <span />
        <span />
        <i />
      </div>
      {src ? (
        <img
          src={src}
          alt={alt}
          width="1440"
          height="900"
          class="block aspect-video w-full object-cover object-top"
        />
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
