import { useEffect } from "preact/hooks";
import { Footer } from "./components/footer.tsx";
import { Nav } from "./components/nav.tsx";
import { startSmoothScroll } from "./lib/smooth-scroll.ts";
import { AgentPayments } from "./sections/agent-payments.tsx";
import { Architecture } from "./sections/architecture.tsx";
import { Capabilities } from "./sections/capabilities.tsx";
import { Developers } from "./sections/developers.tsx";
import { EarlyAccess } from "./sections/early-access.tsx";
import { FinalCta } from "./sections/final-cta.tsx";
import { Hero } from "./sections/hero.tsx";
import { HowItWorks } from "./sections/how-it-works.tsx";
import { Impact } from "./sections/impact.tsx";
import { Principles } from "./sections/principles.tsx";
import { Trust } from "./sections/trust.tsx";
import { UseCases } from "./sections/use-cases.tsx";
import { WhyClearing } from "./sections/why-clearing.tsx";
import { X402Gateway } from "./sections/x402-gateway.tsx";

export function App() {
  useEffect(() => startSmoothScroll(), []);

  return (
    <>
      <a
        href="#platform"
        class="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-60 focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>
      <Nav />
      <main>
        <Hero />
        <Trust />
        <HowItWorks />
        <Capabilities />
        <WhyClearing />
        {/* Placed after the clearing argument and before the architecture: the
            payer-class claim only lands once a reader knows what the layer is,
            and it explains a path the architecture section then has to name. */}
        <AgentPayments />
        <X402Gateway />
        <Architecture />
        <Developers />
        <UseCases />
        <Impact />
        <Principles />
        <EarlyAccess />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
