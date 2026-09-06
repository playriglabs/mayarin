import { useState } from "preact/hooks";

const SOURCES = [
  { label: "Digital assets", detail: "Across supported chains", icon: "assets" },
  { label: "Stablecoins", detail: "Stable value assets", icon: "coins" },
  { label: "Wallets", detail: "Bring the wallet you use", icon: "wallet" },
] as const;

// Settlement varies by custody; these are not fiat off-ramps.
const DESTINATIONS = [
  { label: "Self-custody wallet", detail: "External settlement", icon: "wallet" },
  { label: "Treasury sweep", detail: "External settlement", icon: "treasury" },
  { label: "Merchant balance", detail: "Internal ledger", icon: "ledger" },
] as const;

type Endpoint = (typeof SOURCES)[number] | (typeof DESTINATIONS)[number];

function EndpointIcon({ name }: { name: Endpoint["icon"] }) {
  switch (name) {
    case "assets":
      return <path d="m12 2 8 10-8 10L4 12Zm-8 10 8 4 8-4M12 2v20" />;
    case "coins":
      return (
        <>
          <circle cx="9" cy="14" r="7" />
          <path d="M9 4a7 7 0 1 1 12 9M7 12h4m-4 4h4m-2-6v8" />
        </>
      );
    case "wallet":
      return (
        <>
          <path d="M20 8V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h16v12H5a3 3 0 0 1-3-3V6" />
          <path d="M21 12h-5a3 3 0 0 0 0 6h5m-5-3h.01" />
        </>
      );
    case "treasury":
      return <path d="m2 8 10-6 10 6ZM5 11v8m7-8v8m7-8v8M2 22h20" />;
    case "ledger":
      return (
        <>
          <rect x="4" y="2" width="17" height="20" rx="2" />
          <path d="M9 2v20m4-14h4m-4 5h4m-4 5h4M2 7h4m-4 5h4m-4 5h4" />
        </>
      );
  }
}

function Route({ d, index }: { d: string; index: number }) {
  return (
    <g fill="none" stroke-linecap="round" style={`--route-delay:${-index * 3}s`}>
      <path d={d} class="topology-track" stroke-width="1.5" />
      <path d={d} pathLength="100" class="topology-stream topology-stream-glow" stroke-width="8" />
      <path d={d} pathLength="100" class="topology-stream" stroke-width="2.5" />
    </g>
  );
}

function Hub({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r="84" class="topology-halo" />
      <circle r="70" class="topology-orbit" />
      <circle r="57" class="topology-hub" />
      <g
        transform="translate(-24 -24)"
        fill="none"
        stroke="var(--color-forest)"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M4 8h7c9 0 9 16 19 16h14M4 24h40M4 40h7c9 0 9-16 19-16" />
        <path d="m37 17 7 7-7 7" />
      </g>
    </g>
  );
}

function EndpointCard({ item, x, y }: { item: Endpoint; x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} class="topology-endpoint">
      <rect width="242" height="76" class="topology-card" />
      <path
        d="M0 8V0h8M234 0h8v8M242 68v8h-8M8 76H0v-8"
        fill="none"
        stroke="color-mix(in srgb, var(--color-forest) 45%, var(--color-paper))"
        stroke-width="1.5"
      />
      <circle cx="36" cy="38" r="21" class="topology-icon-disc" />
      <g
        transform="translate(24 26)"
        fill="none"
        stroke="var(--color-forest)"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <EndpointIcon name={item.icon} />
      </g>
      <text x="70" y="33" class="topology-label">
        {item.label}
      </text>
      <text x="70" y="52" class="topology-detail">
        {item.detail}
      </text>
    </g>
  );
}

function TopologyWide() {
  return (
    <svg
      viewBox="0 0 1120 420"
      class="hidden h-auto w-full md:block"
      role="img"
      aria-label="Digital assets, stablecoins and wallets flow through Mayarin clearing to external self-custody wallets, external treasury sweeps, or internal merchant balances."
    >
      <text x="36" y="38" class="topology-caption">
        SOURCES OF VALUE
      </text>
      <text x="842" y="38" class="topology-caption">
        SETTLEMENT DESTINATIONS
      </text>
      {[108, 210, 312].map((y, index) => (
        <Route
          key={y}
          index={index}
          d={`M278 ${y} C414 ${y} 426 210 560 210 C694 210 706 ${y} 842 ${y}`}
        />
      ))}
      {SOURCES.map((item, index) => (
        <EndpointCard key={item.label} item={item} x={36} y={70 + index * 102} />
      ))}
      {DESTINATIONS.map((item, index) => (
        <EndpointCard key={item.label} item={item} x={842} y={70 + index * 102} />
      ))}
      <Hub x={560} y={210} />
      <text x="560" y="333" text-anchor="middle" class="topology-label">
        One clearing layer.
      </text>
      <text x="560" y="355" text-anchor="middle" class="topology-detail">
        Ledger · Routing · Settlement
      </text>
    </svg>
  );
}

function TopologyCompact() {
  return (
    <svg
      viewBox="0 0 360 510"
      class="h-auto w-full md:hidden"
      role="img"
      aria-label="Digital assets, stablecoins and wallets flow through clearing to self-custody wallets, treasury sweeps, or merchant balances. Wallet and treasury settlement is external; merchant balances are internal."
    >
      <text x="180" y="24" text-anchor="middle" class="topology-caption">
        SOURCES OF VALUE
      </text>
      {[60, 180, 300].map((x, index) => (
        <Route
          key={x}
          index={index}
          d={`M${x} 96 C${x} 165 180 160 180 246 C180 330 ${x} 325 ${x} 398`}
        />
      ))}
      {SOURCES.map((item, index) => (
        <g key={item.label} transform={`translate(${60 + index * 120} 74)`}>
          <circle r="26" class="topology-card" />
          <g
            transform="translate(-12 -12)"
            fill="none"
            stroke="var(--color-forest)"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <EndpointIcon name={item.icon} />
          </g>
          <text y="48" text-anchor="middle" class="topology-label">
            {item.label}
          </text>
        </g>
      ))}
      <Hub x={180} y={246} />
      {DESTINATIONS.map((item, index) => (
        <g key={item.label} transform={`translate(${60 + index * 120} 418)`}>
          <circle r="26" class="topology-card" />
          <g
            transform="translate(-12 -12)"
            fill="none"
            stroke="var(--color-forest)"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <EndpointIcon name={item.icon} />
          </g>
          <text y="46" text-anchor="middle" class="topology-label">
            {["Self-custody", "Treasury", "Balance"][index]}
          </text>
          <text y="64" text-anchor="middle" class="topology-detail">
            {index === 2 ? "Internal" : "External"}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function RoutingTopology() {
  const [paused, setPaused] = useState(false);

  return (
    <div class="topology" data-paused={paused}>
      <TopologyWide />
      <TopologyCompact />
      <div class="flex items-center justify-between gap-4 border-t border-forest/10 px-5 py-3 md:px-9">
        <p class="text-xs text-slate">Many sources. One path to settlement.</p>
        <button
          type="button"
          aria-pressed={paused}
          onClick={() => setPaused(!paused)}
          class="topology-pause flex min-h-11 shrink-0 cursor-pointer items-center gap-2 text-xs text-forest"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
            {paused ? <path d="m3 1 8 5-8 5Z" /> : <path d="M2 1h3v10H2zm5 0h3v10H7z" />}
          </svg>
          {paused ? "Resume motion" : "Pause motion"}
        </button>
      </div>
    </div>
  );
}
