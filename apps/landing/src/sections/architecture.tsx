import { Reveal } from "../components/reveal.tsx";
import { Label, Lede, Section, SectionHeading } from "../components/ui.tsx";

const LAYERS = [
  {
    tag: "Interfaces",
    items: ["Merchant app", "Point of sale", "Marketplace", "Wallet"],
  },
  {
    tag: "API surface",
    items: ["Payment resources", "Idempotency keys", "Webhooks", "Event stream"],
  },
  {
    tag: "Domain core",
    items: [
      "Payment Intent",
      "QR Parser",
      "Liquidity Router",
      "Clearing Engine",
      "Double-entry Ledger",
      "Settlement",
    ],
    emphasis: true,
  },
];

const ADAPTERS = [
  "Postgres",
  "Chain clients",
  "QRIS",
  "Bank rails",
  "Settlement providers",
  "Price feeds",
];

export function Architecture() {
  return (
    <Section id="architecture">
      <Reveal>
        <Label>Architecture</Label>
      </Reveal>

      <div class="md:flex md:items-end md:justify-between md:gap-20">
        <Reveal delay={60}>
          <SectionHeading>Ports in the core. Providers at the edge.</SectionHeading>
        </Reveal>
        <Reveal delay={120}>
          <Lede class="md:mb-3 md:max-w-[38ch]">
            The domain depends on interfaces it defines itself. Concrete adapters are chosen once,
            in a single composition root — which is what keeps the core testable without a database
            and portable across providers.
          </Lede>
        </Reveal>
      </div>

      <Reveal delay={80} class="mt-12 border border-line p-5 md:mt-16 md:p-12">
        {LAYERS.map((layer, index) => (
          <div key={layer.tag} class={index > 0 ? "mt-5 md:mt-6" : ""}>
            <div class="flex flex-col gap-4 md:flex-row md:items-center md:gap-8">
              <span class="label w-40 shrink-0 text-slate">{layer.tag}</span>
              <div
                class={`grid flex-1 gap-px bg-line ${
                  layer.items.length > 4
                    ? "grid-cols-2 md:grid-cols-3"
                    : "grid-cols-2 md:grid-cols-4"
                }`}
              >
                {layer.items.map((item) => (
                  <div
                    key={item}
                    class={`flex h-16 items-center justify-center px-3 text-center text-[0.8125rem] ${
                      layer.emphasis ? "bg-ink font-medium text-white" : "bg-paper text-ink"
                    }`}
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}

        <div class="mt-6 flex flex-col gap-3 md:flex-row md:items-center md:gap-8">
          <span class="label w-40 shrink-0 text-forest">Ports</span>
          <div class="flex flex-1 items-center gap-4">
            <span
              aria-hidden="true"
              class="h-px flex-1 bg-[repeating-linear-gradient(to_right,var(--color-forest)_0_4px,transparent_4px_10px)]"
            />
            <span class="label whitespace-nowrap text-slate">no provider crosses this line</span>
            <span
              aria-hidden="true"
              class="h-px flex-1 bg-[repeating-linear-gradient(to_right,var(--color-forest)_0_4px,transparent_4px_10px)]"
            />
          </div>
        </div>

        <div class="mt-6 flex flex-col gap-4 md:flex-row md:items-center md:gap-8">
          <span class="label w-40 shrink-0 text-slate">Adapters</span>
          <div class="grid flex-1 grid-cols-2 gap-px bg-line md:grid-cols-3">
            {ADAPTERS.map((adapter) => (
              <div
                key={adapter}
                class="flex h-16 items-center justify-center bg-paper px-3 text-center text-[0.8125rem] text-slate"
              >
                {adapter}
              </div>
            ))}
          </div>
        </div>
      </Reveal>

      <Reveal delay={140} class="mt-8 flex flex-wrap gap-x-10 gap-y-3">
        {[
          "Domain packages import no provider",
          "Adapters are swapped at the composition root",
          "Every core package is testable without infrastructure",
        ].map((note) => (
          <p key={note} class="flex items-center gap-2.5 text-sm text-slate">
            <span aria-hidden="true" class="size-[5px] bg-accent" />
            {note}
          </p>
        ))}
      </Reveal>
    </Section>
  );
}
