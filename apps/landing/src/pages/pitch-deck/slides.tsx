import type { ComponentChildren } from "preact";
import { GridField } from "../../graphics/grid-field.tsx";
import { WaveGrid } from "../../graphics/wave-grid.tsx";
import {
  ArchitectureFlow,
  AtomicTiles,
  ClaimLedger,
  ClosingOutcome,
  ComparePaths,
  FlowDiagram,
  ProblemBridge,
  ProofAndPilot,
  RiskColumns,
  TeamPortraits,
  TitleLockup,
} from "./visuals.tsx";

/**
 * How a slide enters. The headline and bullets are the reading material and
 * stay put unless named here; the visual is what moves, and only in the way
 * that fits it — a list of steps arrives one by one, a globe fades in, a
 * table just appears.
 */
export type Reveal = {
  /** Animate the headline in. Title and closing slides only. */
  headline?: true;
  /** `stagger` animates each `[data-reveal]` piece of the visual in turn; `fade` fades the visual as one. */
  visual: "stagger" | "fade" | "none";
  /** Seconds between staggered pieces. Default 0.08. */
  stagger?: number;
};

/**
 * One slide of the deck. Text mirrors `docs/pitch-deck.md` slide for slide —
 * that file is the source; change the copy there first.
 */
export type Slide = {
  /** URL hash and DOM id. */
  id: string;
  /** The eyebrow above the headline, e.g. "02 — The problem". */
  label: string;
  /** Short name for the dot navigation and the live region. */
  title: string;
  headline: string;
  /** Pitch-voice bullets. A leading bold phrase is written as `**phrase.** rest`. */
  bullets: readonly string[];
  visual: ComponentChildren;
  /** A full-bleed graphic behind the slide, related to what the slide says. */
  backdrop?: ComponentChildren;
  reveal: Reveal;
  /** Speaker notes, shown with the `N` key. */
  notes: readonly string[];
  /** Seconds of the 7-minute box. Undefined on a backup slide. */
  seconds?: number;
  backup?: true;
};

export const SLIDES: readonly Slide[] = [
  {
    id: "1",
    label: "01 — Mayarin",
    title: "Title",
    headline: "Price in fiat. Settle in stablecoins. Pay with anything.",
    bullets: [
      "A merchant prices in local currency. A customer pays with a supported crypto asset. The merchant receives their chosen stablecoin.",
    ],
    visual: <TitleLockup />,
    backdrop: <GridField />,
    reveal: { headline: true, visual: "fade" },
    notes: [
      "One breath.",
      "Name origin if asked: Indonesian bayar (to pay) + Latin maior (greater). docs/vision.md.",
    ],
    seconds: 20,
  },
  {
    id: "2",
    label: "02 — The team",
    title: "The team",
    headline: "A small team built the payment stack end to end.",
    bullets: [
      "**Rizky — R&D and Core Contributor.** Ex-Kite.",
      "**Rizki Citra — Core Contributor.** Software Engineer at Kolosal AI.",
    ],
    visual: <TeamPortraits />,
    reveal: { visual: "stagger", stagger: 0.14 },
    notes: [
      "Introduce the people once, then let the working product demonstrate execution.",
      "Do not spend time on a chronology of employers or read the profile links aloud; they are there for verification and post-pitch follow-up.",
    ],
    seconds: 30,
  },
  {
    id: "3",
    label: "03 — Why stablecoins, why Mayarin",
    title: "Why stablecoins, why Mayarin",
    headline: "Stablecoins solve settlement. Mayarin solves acceptance.",
    bullets: [
      "A merchant needs a fiat-denominated settlement asset — not the volatility of whichever token a customer happens to hold.",
      "Stablecoins provide an on-chain unit that is always available, programmable, and auditable against the ledger.",
      "**Why now.** Payment networks, banks, and regulators are moving the rail from pilots toward production.",
    ],
    visual: <ProblemBridge />,
    reveal: { visual: "stagger", stagger: 0.07 },
    notes: [
      "Speaker line: Stablecoins are not the product; they are the settlement rail. Mayarin makes the rail usable at checkout.",
      "Stable means a fiat-denominated unit, not risk-free. Issuer, reserve, redemption, and depeg risks remain and are stated in backup B.",
      "Visa launched USDC settlement for US issuers and acquirers on 2025-12-16 and reported more than USD 3.5B in annualized stablecoin settlement volume as of 2025-11-30.",
      "DBS Token Services, announced 2024-10-18, integrates tokenization and smart contracts with transaction banking for instant, 24/7 real-time settlement.",
      "MAS finalized Singapore's stablecoin framework on 2023-08-15 for single-currency stablecoins pegged to SGD or a G10 currency and issued in Singapore.",
      "Open Standard announced Open USD on 2026-06-30 and says 140+ businesses signed up to use it. OUSD remains pre-launch as of August 2026; present it as directional evidence, not live volume.",
      "These signals validate the rail, not Mayarin. The live demo on slide 4 validates Mayarin. Primary-source links are in docs/pitch-deck.md.",
    ],
    seconds: 45,
  },
  {
    id: "4",
    label: "04 — Live payment demo",
    title: "Live payment demo",
    headline: "IDR 36,000 priced. ETH paid. USDC received. One auditable transaction.",
    bullets: [
      "A coffee shop in Jakarta creates a payment for IDR 36,000 — about S$3.",
      "Mayarin quotes and locks the price with a time and slippage bound.",
      "The customer pays ETH from a supported wallet; checkout shows the live testnet quote.",
      "The contract swaps ETH to USDC and delivers the net settlement directly to a merchant-controlled wallet.",
      "Ledger, dashboard, and webhooks update from the confirmed on-chain event.",
    ],
    visual: <FlowDiagram />,
    backdrop: (
      <div aria-hidden="true" class="absolute inset-0 opacity-80">
        <WaveGrid tone="dark" />
        <div
          class="absolute inset-0 hidden md:block"
          style="background: linear-gradient(90deg, var(--color-void) 0%, var(--color-void) 26%, transparent 60%)"
        />
      </div>
    ),
    reveal: { visual: "stagger", stagger: 0.22 },
    notes: [
      "Demo: wallet connected and funded → open IDR checkout → choose ETH → confirm once → merchant dashboard → paid status → USDC settlement → verified transaction.",
      "Keep a completed intent and a 45–60 second recording ready; never wait silently for confirmation.",
      "Real Base Sepolia payment, 2026-08-19, intent pi_01M0D8X65WSYV0T5FQRQVXV5M7. Payer sent 0.012953540 testnet ETH. Settlement 2.019586 testnet USDC, fee 0.012118 USDC, merchant net 2.007468 USDC.",
      "IDR 36,000 is about S$3 at roughly 12,000 IDR per SGD (August 2026). Indonesia writes it Rp 36.000 — dot for thousands — and the product renders it that way; the slide uses IDR 36,000 for an international room.",
      "Base Sepolia is Base's public testnet (Base is Coinbase's Ethereum layer 2).",
      "The testnet Uniswap pool is the price truth, so the ETH amount does not track mainnet prices. Do not speak or feature that amount.",
      "Two execution paths are live: contract path (payer → PaymentRouter → atomic swap → merchant Safe) and deposit path (per-payment address → watcher → executor → PaymentRouter). docs/architecture.md, docs/chain.md.",
      "Every domain module talks to storage, chains, and providers through ports. The backend orchestrates; the contract executes; the backend never holds keys to user assets.",
    ],
    seconds: 130,
  },
  {
    id: "5",
    label: "05 — Why Mayarin",
    title: "Why Mayarin",
    headline: "Payment-gateway simplicity, without surrendering control.",
    bullets: [
      "**One transaction, no custody.** Receive, swap, settle in a single call. Hard revert if the swap misses the locked minimum. The contract holds no balance between payments.",
      "**Merchant-controlled.** The merchant is always a signer on their Safe smart-account wallet, with an independently proven recovery path. Payouts can only reach a verified merchant wallet.",
      "**Provider-agnostic by construction.** Wallets, liquidity venues, oracles, and chains sit behind ports. Swap the source, keep the product.",
      "**Ledger derived from chain truth.** Balanced double-entry postings, reconciled against on-chain events. Every step idempotent and resumable.",
    ],
    visual: <AtomicTiles />,
    reveal: { visual: "stagger" },
    notes: [
      "All four are live on Base Sepolia.",
      "PaymentRouter reverts on a minOut miss and keeps a zero resting balance (docs/chain.md).",
      "WalletGuard accepts audited external payout instructions, verifies managed-wallet fallbacks, and prevents a deployment whose TREASURY_ADDRESS is a merchant wallet from booting (docs/wallet.md).",
      "Money is bigint minor units + AssetCode, no floats (docs/money.md). LedgerImbalanceError rejects an unbalanced posting (docs/ledger.md). Steps keyed transactionId:state; ClearingEngine.resumeStuck recovers stalled payments.",
      "A webhook wakes the engine and never settles a payment by itself.",
      "The passkey custody boundary rests on Turnkey's authorization model — provider-backed.",
    ],
    seconds: 55,
  },
  {
    id: "6",
    label: "06 — From product to pilot",
    title: "From product to pilot",
    headline: "Built today. Ready for a controlled merchant pilot.",
    bullets: [
      "**Working proof.** Three verified Base Sepolia contracts and both execution paths settling end to end.",
      "**Distribution already built.** Payment links and printable QR for zero-code adoption; checkout, SDK, API, and WooCommerce for developers and merchants.",
      "**Regional beachhead.** Merchants across Singapore, Malaysia, and Indonesia share one need: local pricing with stablecoin settlement. Next evidence: a controlled design-partner pilot.",
      "**Business model.** A take rate from settlement. The contract fee primitive is live; merchant pricing and policy come before the pilot.",
    ],
    visual: <ProofAndPilot />,
    backdrop: <GridField />,
    reveal: { visual: "stagger", stagger: 0.05 },
    notes: [
      "docs/roadmap.md. Phases 1–3 and the commerce surfaces are working.",
      "Each contract row links directly to its Base Sepolia Basescan address; invite the jury to open one during questions.",
      "The passkey browser ceremony, fee/refund policy, general gas abstraction, and mainnet hardening remain next; do not describe those as complete.",
      "Multi-chain expansion belongs in Q&A, after evidence of the beachhead.",
    ],
    seconds: 60,
  },
  {
    id: "7",
    label: "07 — Impact and the ask",
    title: "Impact and the ask",
    headline: "One working transaction. A new rail for commerce.",
    bullets: [
      "**Proven.** Fiat pricing → crypto payment → stablecoin settlement, reconciled on Base Sepolia.",
      "**Next.** A controlled mainnet pilot with design-partner merchants.",
      "**Ask.** Merchant and ecosystem partners — plus rigorous custody review.",
    ],
    visual: <ClosingOutcome />,
    reveal: { headline: true, visual: "fade" },
    notes: [
      "Compliance is cheap, not absent: screening port with a disabled default (NOT_SCREENED, never CLEAR); reconciliation states MATCHED / MISMATCHED / NO_ON_CHAIN_RECORD. docs/compliance.md.",
      "Hackathon alignment: Track 1 (Payments and Financial Infrastructure), Track 2 (Web3 Applications and AI). docs/roadmap.md.",
      "Before the pilot: finish fee/refund policy (#12), gas abstraction (#9), and mainnet hardening (#143).",
    ],
    seconds: 40,
  },
  {
    id: "architecture",
    label: "Backup A — System architecture",
    title: "System architecture",
    headline: "One orchestration layer. Two execution paths. One settlement outcome.",
    bullets: [],
    visual: <ArchitectureFlow />,
    reveal: { visual: "fade" },
    notes: [
      "Use this only for technical or architecture questions; it is not part of the timed seven-slide pitch.",
      "The primary contract path performs atomic swap and settlement. The deposit path watches and matches a plain transfer before the executor sweeps it through PaymentRouter.",
      "Both paths converge on the same idempotent clearing, balanced accounting, and reconciliation model. docs/architecture.md, docs/chain.md, docs/clearing-engine.md.",
    ],
    backup: true,
  },
  {
    id: "a",
    label: "Backup B — Risks we carry",
    title: "Risks we carry",
    headline: "What we guarantee, and what we do not.",
    bullets: [
      "We guarantee an amount of the settlement stablecoin, not its fiat value after a depeg.",
      "On the deposit path, our executor holds payer funds briefly while sweeping. The contract path avoids this.",
      "Signing keys, oracles, DEX liquidity, RPCs, and issuers are external dependencies. We bound them; we do not remove them.",
      "The deposit forwarder passed static analysis but has not had an adversarial review. Mainnet hardening is a defined programme.",
    ],
    visual: <RiskColumns />,
    reveal: { visual: "fade" },
    notes: [
      "docs/threat-model.md, PURPOSE.md §19. Depeg guard is RFC #71.",
      "Key compromise reduced by KMS/Turnkey signing, timelocked rotation, multisig governance, router pause, Safe allowlists. Mainnet hardening is RFC #143.",
      "Investors read this slide as a maturity signal.",
    ],
    backup: true,
  },
  {
    id: "b",
    label: "Backup C — Claim ledger",
    title: "Claim ledger",
    headline: "Every claim, its status, and where it is written down.",
    bullets: [],
    visual: <ClaimLedger />,
    reveal: { visual: "none" },
    notes: [
      "Base Sepolia: PaymentRouter 0xEe7c5B5a9eeAf667A6EFb217A8a77534C873f7a9, TimelockController 0x0c006FC14063e3F78271312B975231e4BD6e8B00, DepositForwarderFactory 0x598F64551456BCa2536386ED54A24412E3e32fCe. docs/chain.md.",
    ],
    backup: true,
  },
  {
    id: "compare",
    label: "Backup D — How Mayarin compares",
    title: "How Mayarin compares",
    headline: "Gateway simplicity, with a different custody answer.",
    bullets: [
      "**Custodial gateways — Triple-A, BitPay.** The processor receives the crypto and pays the merchant out afterwards. Simple, but the merchant trusts the processor's balance sheet.",
      "**Ecosystem gateways — Coinbase Commerce.** Self-custody settlement, inside one vendor's stack and asset list.",
      "**Build it in-house.** Back to the slide-3 problem: keys, swaps, gas, reconciliation.",
      "**Mayarin.** Settlement lands in a merchant-controlled wallet in the payment transaction itself, on provider-agnostic ports, priced in local fiat.",
    ],
    visual: <ComparePaths />,
    reveal: { visual: "stagger" },
    notes: [
      "Use this slide only when a comparison question comes; never present it unprompted.",
      "The likely form is: how is this different from Triple-A? Triple-A holds a Singapore payment-institution licence, and the jury may know it.",
      "The one-line answer: a custodial processor shields the merchant from crypto by holding it; Mayarin shields the merchant from crypto without holding it.",
      "If the follow-up is 'but merchants want fiat': the fiat off-ramp is a later phase with its own custody perimeter, and today's target merchant wants stablecoin settlement. Backup B carries the depeg boundary.",
      "These are licensed, shipping products — the difference is architectural, not a quality ranking. Say nothing about them that their own sites do not.",
    ],
    backup: true,
  },
];
