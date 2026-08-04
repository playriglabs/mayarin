import clsx from "clsx";
import type { ComponentChildren, JSX } from "preact";

type Tone = "light" | "dark";

export function Section({
  id,
  tone = "light",
  class: className = "",
  children,
}: {
  id?: string;
  tone?: Tone;
  class?: string;
  children: ComponentChildren;
}) {
  const toned =
    tone === "dark"
      ? "bg-void text-white [--hairline:var(--color-line-inverse)]"
      : "bg-paper text-ink [--hairline:var(--color-line)]";

  return (
    <section id={id} class={clsx("relative", toned, className)}>
      <div class="shell py-24 md:py-28 lg:py-32">{children}</div>
    </section>
  );
}

/** Mono eyebrow with the small square that marks every section opening. */
export function Label({
  children,
  tone = "light",
  class: className = "",
}: {
  children: ComponentChildren;
  tone?: Tone;
  class?: string;
}) {
  return (
    <p
      class={clsx(
        "label flex items-center gap-2.5",
        tone === "dark" ? "text-slate-inverse" : "text-slate",
        className,
      )}
    >
      <span aria-hidden="true" class="inline-block size-1.5 bg-accent" />
      {children}
    </p>
  );
}

export function SectionHeading({
  children,
  class: className = "",
}: {
  children: ComponentChildren;
  class?: string;
}) {
  return (
    <h2 class={clsx("mt-7 max-w-[19ch] text-[clamp(3.3rem,5.2vw,4.25rem)]", className)}>
      {children}
    </h2>
  );
}

export function Lede({
  children,
  tone = "light",
  class: className = "",
}: {
  children: ComponentChildren;
  tone?: Tone;
  class?: string;
}) {
  return (
    <p
      class={clsx(
        "mt-6 max-w-[58ch] text-[1.0625rem] leading-[1.65] md:text-lg",
        tone === "dark" ? "text-slate-inverse" : "text-slate",
        className,
      )}
    >
      {children}
    </p>
  );
}

type ButtonProps = {
  href: string;
  children: ComponentChildren;
  variant?: "primary" | "secondary" | "primary-dark" | "secondary-dark";
  class?: string;
};

/* The filled variants wipe their hover colour in; the outline ones have no
   background to wipe and keep the plain border transition. */
const buttonVariants: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "btn-fill [--btn-fill:var(--color-forest)] bg-ink text-white",
  secondary: "border border-line text-ink hover:border-ink",
  "primary-dark": "btn-fill [--btn-fill:var(--color-white)] bg-accent text-void",
  "secondary-dark": "border border-line-inverse text-white hover:border-white",
};

export function Button({
  href,
  children,
  variant = "primary",
  class: className = "",
}: ButtonProps) {
  return (
    <a
      href={href}
      class={clsx(
        "inline-flex h-12 cursor-pointer items-center justify-center gap-2 px-7 text-sm font-medium transition-colors duration-200",
        buttonVariants[variant],
        className,
      )}
    >
      {children}
    </a>
  );
}

export function ArrowRight(props: JSX.SVGAttributes<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      width="14"
      height="14"
      stroke="currentColor"
      stroke-width="1.5"
      {...props}
    >
      <path d="M2.5 8h11M9 3.5 13.5 8 9 12.5" stroke-linecap="square" />
    </svg>
  );
}

/** Full-bleed hairline. Uses the tone-scoped `--hairline` set by `Section`. */
export function Rule({ class: className = "" }: { class?: string }) {
  return <div class={clsx("h-px w-full bg-(--hairline,var(--color-line))", className)} />;
}
