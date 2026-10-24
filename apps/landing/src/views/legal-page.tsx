import type { ComponentChildren } from "preact";
import { Footer } from "../components/footer.tsx";

export type LegalSection = {
  readonly title: string;
  readonly body: ComponentChildren;
};

export function P({ children }: { readonly children: ComponentChildren }) {
  return <p class="text-base leading-[1.75] text-slate-600 md:text-[17px]">{children}</p>;
}

export function List({ children }: { readonly children: ComponentChildren }) {
  return (
    <ul class="list-disc space-y-2 pl-5 text-base leading-[1.75] text-slate-600 marker:text-slate-400 md:text-[17px]">
      {children}
    </ul>
  );
}

export function Strong({ children }: { readonly children: ComponentChildren }) {
  return <strong class="font-medium text-ink">{children}</strong>;
}

/** One reading column: title, date, then numbered sections, then the site footer. */
export function LegalPage({
  title,
  updated,
  intro,
  sections,
}: {
  readonly title: string;
  readonly updated: string;
  readonly intro: string;
  readonly sections: readonly LegalSection[];
}) {
  return (
    <div class="bg-paper text-ink [&_h1]:tracking-[-0.055em] [&_h2]:tracking-[-0.04em] [&_h2]:leading-[1.15]">
      <header class="border-b border-line">
        <div class="shell flex h-16 items-center justify-between">
          <a
            href="/"
            aria-label="Mayarin home"
            class="text-[1.8rem] leading-none font-medium tracking-[-0.06em]"
          >
            mayarin
          </a>
          <a
            href="/"
            class="text-sm text-slate-600 transition-colors duration-200 hover:text-brand"
          >
            ← Back
          </a>
        </div>
      </header>

      <main class="shell pt-16 pb-24 md:pt-24 md:pb-32">
        <div class="mx-auto max-w-3xl">
          <h1 class="text-[clamp(2.5rem,6vw,4.5rem)] leading-[0.95]">{title}</h1>
          <p class="text-sm mt-6 text-slate-600">Last updated {updated}</p>
          <p class="mt-8 text-lg leading-[1.7] text-slate-600">{intro}</p>

          <div class="mt-14 space-y-12 md:mt-20 md:space-y-16">
            {sections.map((section, index) => (
              <section key={section.title} aria-labelledby={`section-${index + 1}`}>
                <h2
                  id={`section-${index + 1}`}
                  class="border-b border-line pb-4 text-[1.5rem] md:text-[1.75rem]"
                >
                  {index + 1}. {section.title}
                </h2>
                <div class="mt-6 space-y-4">{section.body}</div>
              </section>
            ))}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
