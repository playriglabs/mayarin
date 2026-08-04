const SOURCES = ["Digital assets", "Stablecoins", "Wallets"];

/**
 * The right-hand side is settlement, not acceptance. QRIS, PayNow and PromptPay
 * are QR schemes the parser *decodes* on the way in — putting them here read as
 * though a merchant gets paid over the same rail the payer scanned.
 *
 * What a settlement adapter actually produces is one of two postings, and the
 * mode is the port-level fact the clearing engine branches on: `external` moves
 * value out of Mayarin, `internal` keeps it as a merchant balance.
 */
const RAILS = [
  { label: "Bank transfer", mode: "external" },
  { label: "On-chain transfer", mode: "external" },
  { label: "Merchant balance", mode: "internal" },
];

const inbound = [
  "M104 140 H316 C436 140 480 280 600 280",
  "M104 280 H600",
  "M104 420 H316 C436 420 480 280 600 280",
];

const outbound = [
  "M600 280 C724 280 764 140 884 140 H1096",
  "M600 280 H1096",
  "M600 280 C724 280 764 420 884 420 H1096",
];

const inboundY = [140, 280, 420];
const outboundY = [140, 280, 420];

/**
 * Wide routing topology: many sources of value collapse into a single clearing
 * node, then fan back out to the rails a merchant actually gets paid on.
 */
function TopologyWide() {
  return (
    <svg
      viewBox="0 0 1200 560"
      class="hidden h-auto w-full md:block"
      role="img"
      aria-label="Digital assets, stablecoins and wallets routed through a single clearing node, then settled out as an external bank transfer, an external on-chain transfer, or an internal merchant balance."
    >
      <title>Mayarin routing topology</title>

      {inbound.map((d, index) => (
        <g key={d}>
          <path d={d} pathLength={196} fill="none" stroke="var(--color-line)" stroke-width="1" />
          <path
            d={d}
            pathLength={196}
            fill="none"
            stroke="var(--color-accent)"
            stroke-width="1.5"
            class="flow-line"
            style={`--flow-delay:${index * 0.9}s`}
          />
        </g>
      ))}

      {outbound.map((d, index) => (
        <g key={d}>
          <path d={d} pathLength={196} fill="none" stroke="var(--color-line)" stroke-width="1" />
          <path
            d={d}
            pathLength={196}
            fill="none"
            stroke="var(--color-accent)"
            stroke-width="1.5"
            class="flow-line"
            style={`--flow-delay:${1.6 + index * 0.7}s`}
          />
        </g>
      ))}

      {inboundY.map((y, index) => (
        <g key={y}>
          <circle cx="104" cy={y} r="4" fill="var(--color-ink)" />
          <text
            x="104"
            y={y - 22}
            fill="var(--color-slate)"
            font-family="var(--font-mono)"
            font-size="12"
            letter-spacing="1.6"
          >
            {SOURCES[index]?.toUpperCase()}
          </text>
        </g>
      ))}

      {outboundY.map((y, index) => (
        <g key={y}>
          <rect x="1092" y={y - 4} width="8" height="8" fill="var(--color-ink)" />
          <text
            x="1096"
            y={y - 34}
            text-anchor="end"
            fill="var(--color-slate)"
            font-family="var(--font-mono)"
            font-size="12"
            letter-spacing="1.6"
          >
            {RAILS[index]?.label.toUpperCase()}
          </text>
          <text
            x="1096"
            y={y - 16}
            text-anchor="end"
            fill="var(--color-slate)"
            opacity="0.55"
            font-family="var(--font-mono)"
            font-size="10"
            letter-spacing="1.2"
          >
            {RAILS[index]?.mode.toUpperCase()}
          </text>
        </g>
      ))}

      {/* Clearing node */}
      <circle
        cx="600"
        cy="280"
        r="26"
        fill="none"
        stroke="var(--color-line)"
        stroke-dasharray="2 5"
      />
      <circle cx="600" cy="280" r="11" fill="var(--color-paper)" stroke="var(--color-ink)" />
      <circle cx="600" cy="280" r="4" fill="var(--color-accent)" class="flow-dot" />
      <text
        x="600"
        y="222"
        text-anchor="middle"
        fill="var(--color-ink)"
        font-family="var(--font-mono)"
        font-size="12"
        letter-spacing="1.8"
      >
        CLEARING
      </text>
      <line x1="600" y1="326" x2="600" y2="352" stroke="var(--color-line)" stroke-dasharray="2 4" />
      <text
        x="600"
        y="372"
        text-anchor="middle"
        fill="var(--color-slate)"
        font-family="var(--font-mono)"
        font-size="11"
        letter-spacing="1.4"
      >
        LEDGER · SETTLEMENT
      </text>
    </svg>
  );
}

const mobileIn = [
  "M60 96 C60 150 170 150 170 196",
  "M170 96 V196",
  "M280 96 C280 150 170 150 170 196",
];

const mobileOut = [
  "M170 244 C170 300 60 300 60 356",
  "M170 244 V356",
  "M170 244 C170 300 280 300 280 356",
];

const mobileSources = ["ASSETS", "STABLES", "WALLETS"];
const mobileRails = ["BANK", "ON-CHAIN", "BALANCE"];

function TopologyCompact() {
  return (
    <svg
      viewBox="0 0 340 400"
      class="h-auto w-full"
      role="img"
      aria-label="Digital assets, stablecoins and wallets routed through a single clearing node, then settled out as a bank transfer, an on-chain transfer, or a merchant balance."
    >
      <title>Mayarin routing topology</title>

      {[...mobileIn, ...mobileOut].map((d, index) => (
        <g key={d}>
          <path d={d} pathLength={196} fill="none" stroke="var(--color-line)" stroke-width="1" />
          <path
            d={d}
            pathLength={196}
            fill="none"
            stroke="var(--color-accent)"
            stroke-width="1.5"
            class="flow-line"
            style={`--flow-delay:${index * 0.8}s`}
          />
        </g>
      ))}

      {[60, 170, 280].map((x, index) => (
        <g key={x}>
          <circle cx={x} cy="96" r="3.5" fill="var(--color-ink)" />
          <text
            x={x}
            y="74"
            text-anchor="middle"
            fill="var(--color-slate)"
            font-family="var(--font-mono)"
            font-size="10"
            letter-spacing="1"
          >
            {mobileSources[index]}
          </text>
        </g>
      ))}

      {[60, 170, 280].map((x, index) => (
        <g key={x}>
          <rect x={x - 3.5} y="352" width="7" height="7" fill="var(--color-ink)" />
          <text
            x={x}
            y="380"
            text-anchor="middle"
            fill="var(--color-slate)"
            font-family="var(--font-mono)"
            font-size="10"
            letter-spacing="0.6"
          >
            {mobileRails[index]}
          </text>
        </g>
      ))}

      <circle
        cx="170"
        cy="220"
        r="22"
        fill="none"
        stroke="var(--color-line)"
        stroke-dasharray="2 5"
      />
      <circle cx="170" cy="220" r="10" fill="var(--color-paper)" stroke="var(--color-ink)" />
      <circle cx="170" cy="220" r="3.5" fill="var(--color-accent)" class="flow-dot" />
      <text
        x="170"
        y="180"
        text-anchor="middle"
        fill="var(--color-ink)"
        font-family="var(--font-mono)"
        font-size="10"
        letter-spacing="1.4"
      >
        CLEARING
      </text>
    </svg>
  );
}

export function RoutingTopology() {
  return (
    <div class="w-full">
      <TopologyWide />
      <div class="mx-auto max-w-104 md:hidden">
        <TopologyCompact />
      </div>
    </div>
  );
}
