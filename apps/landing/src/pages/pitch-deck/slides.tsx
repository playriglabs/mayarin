import type { ComponentChildren } from "preact";
import { GridField } from "../../graphics/grid-field.tsx";
import { WaveGrid } from "../../graphics/wave-grid.tsx";
import {
  ArchitectureFlow,
  AtomicTiles,
  AudienceAndGoal,
  ClaimLedger,
  FlowDiagram,
  FrictionCards,
  RiskColumns,
  TeamAndAsk,
  ThreeColumns,
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
    headline: "Merchants can accept crypto without becoming crypto companies.",
    bullets: [
      "Price in local currency. Let customers pay with a supported crypto asset. Settle in the merchant's chosen stablecoin.",
    ],
    visual: <TitleLockup />,
    backdrop: <GridField />,
    reveal: { headline: true, visual: "fade" },
    notes: [
      "Opening line: Accepting crypto is easy. Settling it correctly is hard.",
      "Name origin only if asked: Indonesian bayar (to pay) + Latin maior (greater). docs/vision.md.",
    ],
    seconds: 20,
  },
  {
    id: "2",
    label: "02 — The settlement gap",
    title: "The settlement gap",
    headline:
      "The customer holds any crypto assets. The price is in any local fiat currency. The merchant only wants USDC.",
    bullets: [
      "The customer should not hunt for the one asset a merchant accepts.",
      "The merchant should not manage keys, exchange rates, swaps, gas, and reconciliation after every sale.",
      "A checkout is not complete when crypto arrives. It is complete when the merchant receives the correct settlement and can prove it.",
    ],
    visual: <FrictionCards />,
    reveal: { visual: "stagger", stagger: 0.1 },
    notes: [
      "Keep this concrete. Do not define stablecoins or explain blockchain.",
      "The mismatch between customer asset, store price, and merchant settlement is the problem. Stablecoins are the rail, not the product.",
    ],
    seconds: 40,
  },
  {
    id: "3",
    label: "03 — One clearing layer",
    title: "One clearing layer",
    headline: "One clearing layer closes all three gaps.",
    bullets: [
      "The merchant prices in the currency they understand.",
      "The customer pays with a supported asset through a wallet or a plain transfer.",
      "Mayarin quotes, converts, settles, and records the payment; the merchant receives the stablecoin they selected.",
    ],
    visual: <ThreeColumns />,
    reveal: { visual: "stagger", stagger: 0.1 },
    notes: [
      "Speaker line: Mayarin is the merchant-grade clearing layer behind the checkout.",
      "Provider names and architecture belong after proof or in Q&A.",
      "Stable means a fiat-denominated unit, not risk-free. Issuer, reserve, redemption, and depeg risks remain and are stated in backup B.",
    ],
    seconds: 35,
  },
  {
    id: "4",
    label: "04 — Live payment demo",
    title: "Live payment demo",
    headline: "IDR 299,000 priced. Testnet ETH paid. USDC settled. Chain and ledger agree.",
    bullets: [
      "Parahyangan Supply, an apparel brand in Bandung, sells the Rinjani Cargo Pants for IDR 299,000 — about S$25.",
      "Mayarin locks the quote and issues a per-payment address for testnet ETH.",
      "The payer transfers the exact amount; the watcher confirms and matches it.",
      "The executor calls PaymentRouter, swaps through Uniswap, and settles net USDC to the merchant-controlled wallet.",
      "The confirmed settlement event updates the ledger, dashboard, and webhook.",
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
      "[DEMO MOMENT — HAND OVER TO CITRA] Rizky introduces the Rinjani Cargo Pants example in one sentence; Citra follows docs/hackathon-demo-runbook.md and switches to the prepared checkout.",
      "The product is real demo catalog data: Rinjani Cargo Pants, olive ripstop with six pockets and an adjustable waist, IDR 299,000.",
      "Demo: prepared checkout → choose ETH → scan the per-payment address with a pre-funded phone wallet → visible status timeline → merchant payment detail → USDC settlement → webhook delivery → two chain proofs.",
      "Keep a completed intent and a 45–60 second recording ready; never wait silently for confirmation.",
      "This proof is the deposit path, not the single-call contract path. It consists of a payer transfer and a separate executor settlement; the executor briefly holds the payer asset between them.",
      "Recorded proof, 2026-08-19, from an earlier IDR 36,000 run: intent pi_01M0D8X65WSYV0T5FQRQVXV5M7. Payer sent 0.012953540 testnet ETH. Settlement output 2.019586 testnet USDC, fee 0.012118 USDC, merchant net 2.007468 USDC. Record a rehearsal payment at IDR 299,000 before stage.",
      "The Base Sepolia pool is execution proof, not a mainnet price market. Do not feature the ETH amount.",
      "IDR 299,000 is about S$25 at roughly 12,000 IDR per SGD (August 2026). Base Sepolia is Base's public testnet.",
      '[DEMO MOMENT — RETURN TO DECK, SLIDE 5] Close with: "Correct amount, merchant control, and a provable outcome."',
      "docs/liquidity-routing.md, docs/architecture.md, docs/chain.md.",
    ],
    seconds: 130,
  },
  {
    id: "5",
    label: "05 — The guarantees",
    title: "The guarantees",
    headline: "Correct amount. Merchant control. Provable outcome.",
    bullets: [
      "**Correct amount.** A signed settlement minimum and deadline bound the quote; PaymentRouter hard-reverts below the lock.",
      "**Merchant control.** Settlement can only reach an admitted merchant wallet; the primary contract path receives, swaps, and settles atomically with zero resting balance.",
      "**Provable outcome.** Confirmed chain events produce balanced double-entry postings, reconciliation, and signed merchant webhooks.",
    ],
    visual: <AtomicTiles />,
    reveal: { visual: "stagger" },
    notes: [
      "Do not let the atomic contract-path guarantee rewrite the deposit-path demo.",
      "Both paths are live and converge on the same clearing and accounting model; only the contract path is single-call and non-custodial throughout.",
      "The deposit path's brief operator custody is stated in backup B.",
      "WalletGuard accepts audited external payouts, verifies managed-wallet fallbacks, and refuses unsafe treasury overlap.",
      "Money is exact integer minor units; unbalanced postings throw. Every clearing step is idempotent and resumable.",
      "docs/chain.md, docs/wallet.md, docs/money.md, docs/ledger.md.",
    ],
    seconds: 55,
  },
  {
    id: "6",
    label: "06 — Who Mayarin is for",
    title: "Who Mayarin is for",
    headline: "Merchant platforms first. Payment infrastructure next.",
    bullets: [
      "**Primary users.** Merchant platforms and marketplaces that price locally and settle in stablecoins.",
      "**Expansion path.** Payment processors, wallets, and stablecoin platforms first; creators, freelancers, and agencies next.",
      "**Our goal.** A controlled Southeast Asian merchant pilot measured by settlement reliability, reconciliation, and integration speed.",
    ],
    visual: <AudienceAndGoal />,
    backdrop: <GridField />,
    reveal: { visual: "stagger", stagger: 0.05 },
    notes: [
      "This narrows the landing page's eight use cases into one beachhead and two expansion groups; it does not claim every use case is already integrated.",
      "Merchant platforms and marketplaces are the primary design-partner target. Payment processors, wallets, and stablecoin platforms are distribution partners; creators, freelancers, and agencies are the next self-serve audience.",
      "The controlled pilot is the next evidence, not a live traction claim.",
      "apps/landing/src/sections/use-cases.tsx, docs/roadmap.md.",
    ],
    seconds: 60,
  },
  {
    id: "7",
    label: "07 — Team and the ask",
    title: "Team and the ask",
    headline: "Built end to end by a small team. Ready for a controlled merchant pilot.",
    bullets: [
      "**Rizky — R&D and Core Contributor.** Ex-Kite.",
      "**Rizki Citra — Core Contributor.** Software Engineer at Kolosal AI.",
      "**Ask.** Design-partner merchants, ecosystem partners, and rigorous custody review.",
    ],
    visual: <TeamAndAsk />,
    reveal: { headline: true, visual: "fade" },
    notes: [
      "Introduce the people once; do not read employer history or profile links aloud. Close on the ask.",
      "Compliance is cheap, not absent: disabled screening reports NOT_SCREENED, never CLEAR; reconciliation reports MATCHED, MISMATCHED, or NO_ON_CHAIN_RECORD.",
      "Agent Pay remains later until the identity, limits, approval, and revocation controls in PURPOSE.md §21 are implemented.",
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
];
