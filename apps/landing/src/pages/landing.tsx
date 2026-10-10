import { useEffect } from "preact/hooks";
import { Footer } from "../components/footer.tsx";
import { Benefits } from "../components/landing/benefits.tsx";
import { Capabilities } from "../components/landing/capabilities.tsx";
import { Developers } from "../components/landing/developers.tsx";
import { EarlyAccessCta } from "../components/landing/early-access-cta.tsx";
import { Faq } from "../components/landing/faq.tsx";
import { Navigation } from "../components/landing/nav.tsx";
import { Opportunity } from "../components/landing/opportunity.tsx";
import { PaymentReach } from "../components/landing/payment-reach.tsx";
import { Reach } from "../components/landing/reach.tsx";
import { Hero, ValueStrip } from "../components/landing/sections.tsx";
import { UseCases } from "../components/landing/use-cases.tsx";
import { Why } from "../components/landing/why.tsx";
import { startSmoothScroll } from "../lib/smooth-scroll.ts";

export function Landing() {
  useEffect(() => startSmoothScroll(), []);
  return (
    <>
      <div
        class="bg-paper text-ink [&_section]:scroll-mt-24 [&_h1]:tracking-[-0.055em] [&_h2]:text-[clamp(2.4rem,4.4vw,3.5rem)] [&_h2]:leading-[1.1] [&_h2]:tracking-[-0.045em] [&_h3]:tracking-[-0.035em] [&_h3]:leading-[1.18] [&_h4]:tracking-tight [&_h4]:leading-[1.2]"
        id="top"
      >
        <Navigation />
        <main id="main">
          <Hero />
          <Opportunity />
          <PaymentReach />
          <ValueStrip />
          <Benefits />
          <Capabilities />
          <UseCases />
          <Why />
          <Reach />
          <Developers />
          <Faq />
          <EarlyAccessCta />
        </main>
      </div>
      <Footer />
    </>
  );
}
