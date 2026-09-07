import { useEffect } from "preact/hooks";
import { Footer } from "../components/footer.tsx";
import { Capabilities } from "../components/landing/capabilities.tsx";
import { Facts } from "../components/landing/facts.tsx";
import { Navigation } from "../components/landing/nav.tsx";
import { Principles } from "../components/landing/principles.tsx";
import { Reach } from "../components/landing/reach.tsx";
import { Hero, PoweredBy, ValueStrip } from "../components/landing/sections.tsx";
import { UseCases } from "../components/landing/use-cases.tsx";
import { startSmoothScroll } from "../lib/smooth-scroll.ts";

export function Landing() {
  useEffect(() => startSmoothScroll(), []);
  return (
    <>
      <div
        class="bg-paper text-ink [&_section]:scroll-mt-24 [&_h1]:tracking-[-0.055em] [&_h2]:text-[clamp(2.4rem,4.4vw,3.8rem)] [&_h2]:leading-[1.1] [&_h2]:tracking-[-0.045em] [&_h3]:tracking-[-0.035em] [&_h3]:leading-[1.18] [&_h4]:tracking-tight [&_h4]:leading-[1.2]"
        id="top"
      >
        <a
          class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-70 focus:bg-paper focus:p-4"
          href="#main"
        >
          Skip to content
        </a>
        <Navigation />
        <main id="main">
          <Hero />
          <ValueStrip />
          <Capabilities />
          <UseCases />
          <PoweredBy />
          <Reach />
          <Principles />
          <Facts />
        </main>
      </div>
      <Footer />
    </>
  );
}
