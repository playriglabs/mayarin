import { Reveal } from "../reveal.tsx";
import { USE_CASES, UseCaseIcon } from "../use-case-content.tsx";
import { CardCarousel } from "./card-carousel.tsx";
import { SectionIntro } from "./ui.tsx";

export function UseCases() {
  return (
    <section id="use-cases" class="mx-auto w-full max-w-300 px-5 py-20 md:px-10 md:py-28">
      <div class="grid items-start gap-12 lg:grid-cols-[0.85fr_1.4fr] lg:gap-16">
        <Reveal>
          <SectionIntro
            centered={false}
            title={
              <>
                Big ideas.
                <br />
                Small teams.
                <br />
                And everything in between.
              </>
            }
          >
            From merchant platforms to creators and autonomous agents, find where Mayarin fits into
            your business.
          </SectionIntro>
        </Reveal>
        <CardCarousel
          id="v2-use-case-track"
          ariaLabel="Business use cases. Swipe or use the left and right arrow keys to explore."
          noun="use cases"
          items={USE_CASES}
          pageSize={4}
          renderItem={(item) => (
            <article
              key={item.title}
              class="border-l border-line py-4 pl-6 pr-5 sm:min-h-64 md:pl-7"
            >
              <div class="flex items-start gap-3">
                <span class="flex size-9 shrink-0 items-center justify-center rounded-md bg-v2-mist text-ink">
                  <svg viewBox="0 0 24 24" class="size-6" aria-hidden="true">
                    <UseCaseIcon name={item.icon} />
                  </svg>
                </span>
                <h3 class="pt-1 text-[1.5rem]">{item.title}</h3>
              </div>
              <p class="mt-6 text-[15px] leading-relaxed text-slate-600">{item.body}</p>
            </article>
          )}
        />
      </div>
    </section>
  );
}
