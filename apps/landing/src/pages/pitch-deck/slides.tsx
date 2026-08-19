import type { ComponentChildren } from "preact";
import {
  AdapterRings,
  AtomicTiles,
  ClaimLedger,
  FlowDiagram,
  FrictionCards,
  LiveSurfaces,
  MerchantStory,
  RiskColumns,
  ThreeColumns,
  TitleLockup,
} from "./visuals.tsx";

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
      "Mayarin — programmable crypto-commerce infrastructure.",
      "Merchants price in their currency and receive a stablecoin.",
      "Customers pay with any supported crypto asset.",
    ],
    visual: <TitleLockup />,
    notes: [
      "One breath.",
      "Name origin if asked: Indonesian bayar (to pay) + Latin maior (greater). docs/vision.md.",
    ],
    seconds: 20,
  },
  {
    id: "2",
    label: "02 — The problem",
    title: "The problem",
    headline: "Accepting crypto today turns a merchant into a treasury desk.",
    bullets: [
      "Merchants must run keys, wallets, swaps, gas, and reconciliation — or bolt crypto onto a fiat gateway and reconcile by hand.",
      "Customers rarely hold the exact token a merchant wants, and wallet UIs are not built for invoices.",
      "Developers rebuild the same payment state machine on fragmented APIs, wallets, DEXs, and chains.",
      "Backends become custodians by accident, and ledgers drift from what the chain says.",
    ],
    visual: <FrictionCards />,
    notes: [
      "PURPOSE.md §2, docs/vision.md.",
      "Framing line: crypto adoption does not require merchants to become crypto operators.",
    ],
    seconds: 50,
  },
  {
    id: "3",
    label: "03 — What Mayarin is",
    title: "What Mayarin is",
    headline:
      "Pricing, quoting, execution, settlement, and accounting — as infrastructure, not the merchant's job.",
    bullets: [
      "The merchant prices in local fiat and picks a settlement stablecoin.",
      "The customer pays in any supported asset.",
      "Mayarin quotes, locks the price, converts on-chain in one atomic step when assets differ, settles, and records.",
      "One API and one SDK. Storefronts, POS, invoices, and embedded checkout build on top.",
    ],
    visual: <ThreeColumns />,
    notes: [
      "The 'not' strip is a credibility device. docs/vision.md → Non-Goals.",
      "Stablecoins are the settlement rail. Wallet infra, DEX liquidity, and oracles exist as primitives; the orchestration layer above them did not.",
      "Primitives are provider-backed: Turnkey, Safe, Uniswap, 0x, LiFi, Pyth, Chainlink.",
    ],
    seconds: 50,
  },
  {
    id: "4",
    label: "04 — How a payment works",
    title: "How a payment works",
    headline: "Rp 10.000 in. ETH paid. USDC received. One transaction.",
    bullets: [
      "Merchant creates a payment for Rp 10.000.",
      "Mayarin quotes and locks the price with a time and slippage bound.",
      "Customer pays 0.003551410 ETH from any wallet.",
      "The contract swaps ETH to USDC and delivers 0.556149 USDC to the merchant's wallet in one transaction.",
      "Ledger, dashboard, and webhooks update from the confirmed on-chain event.",
    ],
    visual: <FlowDiagram />,
    notes: [
      "Real Base Sepolia payment, 2026-08-19, intent pi_01M0CJZCBM024BM35FP6H0NWW3. Settlement 0.559507 USDC, fee 0.003358 USDC, merchant net 0.556149 USDC.",
      "The testnet Uniswap pool is the price truth, so the ETH amount does not track mainnet prices.",
      "Two execution paths are live: contract path (payer → PaymentRouter → atomic swap → merchant Safe) and deposit path (per-payment address → watcher → executor → PaymentRouter). docs/architecture.md, docs/chain.md.",
      "Every domain module talks to storage, chains, and providers through ports. The backend orchestrates; the contract executes; the backend never holds keys to user assets.",
    ],
    seconds: 80,
  },
  {
    id: "5",
    label: "05 — Why Mayarin",
    title: "Why Mayarin",
    headline: "Atomic on-chain settlement without a custodial FX desk.",
    bullets: [
      "**One transaction, no custody.** Receive, swap, settle in a single call. Hard revert if the swap misses the locked minimum. The contract holds no balance between payments.",
      "**Provisioned, not custodial.** The merchant is always a signer on their Safe. Payouts can only reach a verified merchant wallet — enforced on-chain.",
      "**Provider-agnostic by construction.** Wallets, liquidity venues, oracles, and chains sit behind ports. Swap the source, keep the product.",
      "**Ledger derived from chain truth.** Balanced double-entry postings, reconciled against on-chain events. Every step idempotent and resumable.",
    ],
    visual: <AtomicTiles />,
    notes: [
      "All four are live on Base Sepolia.",
      "PaymentRouter reverts on a minOut miss and keeps a zero resting balance (docs/chain.md).",
      "WalletGuard refuses a payout to an unverified wallet; a deployment whose TREASURY_ADDRESS is a merchant wallet does not boot (docs/wallet.md).",
      "Money is bigint minor units + AssetCode, no floats (docs/money.md). LedgerImbalanceError rejects an unbalanced posting (docs/ledger.md). Steps keyed transactionId:state; ClearingEngine.resumeStuck recovers stalled payments.",
      "A webhook wakes the engine and never settles a payment by itself.",
      "The passkey custody boundary rests on Turnkey's authorization model — provider-backed.",
    ],
    seconds: 60,
  },
  {
    id: "6",
    label: "06 — Live today",
    title: "Live today",
    headline: "Live on Base Sepolia today. Not a roadmap drawing.",
    bullets: [
      "Three contracts deployed and verified. Both execution paths settle end to end.",
      "Full commerce surface: catalog, carts, payment links, hosted checkout, embeddable checkout, WooCommerce plugin.",
      "Merchant dashboard: products, orders, customers, payments, settlement, wallets, webhooks, API keys, event log.",
      "Managed self-custody wallets: a Safe provisioned from a passkey. No MetaMask, no seed phrase.",
      "Developer surface: TypeScript SDK, REST API, signed webhooks, real-time status.",
    ],
    visual: <LiveSurfaces />,
    notes: [
      "docs/roadmap.md. Phases 1–3 complete; Phase 4 mostly complete. Everything on this slide is live.",
      "Not on this slide, by rule: passkey browser ceremony, on-chain fee and refund split (#12), gas-free withdrawal (#9), OG images (#166 in review), freeze handling and export.",
      "Bring a live demo payment through the demo marketplace.",
    ],
    seconds: 50,
  },
  {
    id: "7",
    label: "07 — Scale and go-to-market",
    title: "Scale and go-to-market",
    headline: "Global by design, local by default.",
    bullets: [
      "The payment intent is the constant. Assets, chains, venues, and providers are adapters around it — we add adapters, not rewrites.",
      "Next: more payer assets, more liquidity venues, more EVM chains, then Solana and TRON.",
      "Distribution: payment links and a static QR with zero code, then embeddable checkout and WooCommerce, then the full dashboard.",
      "Beachhead: Indonesia and Southeast Asia, where merchants think in rupiah and customers hold crypto.",
      "Revenue: a fee split from the merchant settlement inside the same transaction. The merchant never pays gas to receive.",
    ],
    visual: <AdapterRings />,
    notes: [
      "Phase 5 (RFCs #17–#21) and Phase 6, docs/roadmap.md. IDR and MYR pricing already proven in the catalog.",
      "Cross-chain settlement is a separate bridge trust model — later. Fiat off-ramp is a later phase with its own custody perimeter. Treasury stays a fee recipient and gas funder, never an FX book.",
      "Fee mechanism is live in the contract (minOut − fee to merchant, fee to treasury, excess refunded). Backend fee and refund policy is next (#12). Take-rate is a release decision.",
      "Agent Pay is later; mention only if asked. PURPOSE.md §22.",
    ],
    seconds: 50,
  },
  {
    id: "8",
    label: "08 — Impact and the ask",
    title: "Impact and the ask",
    headline: "Any merchant, any customer, any asset — with the merchant in control.",
    bullets: [
      "Merchants reach global crypto liquidity without giving up custody or learning blockchain.",
      "Every payment is auditable: a balanced ledger entry and an on-chain event, reconciled against each other.",
      "Built in Indonesia, architected for any local currency.",
      "**The ask (judges):** shipped, not slideware — scrutinise the testnet.",
      "**The ask (investors):** seed to finish Phase 4 and open Phase 5 multi-chain.",
    ],
    visual: <MerchantStory />,
    notes: [
      "Compliance is cheap, not absent: screening port with a disabled default (NOT_SCREENED, never CLEAR); reconciliation states MATCHED / MISMATCHED / NO_ON_CHAIN_RECORD. docs/compliance.md.",
      "Hackathon alignment: Track 1 (Payments and Financial Infrastructure), Track 2 (Web3 Applications and AI). docs/roadmap.md.",
      "Phase 4 behind the investor ask: on-chain fee split (#12), gas-free withdrawals (#9), mainnet hardening (#143).",
    ],
    seconds: 40,
  },
  {
    id: "a",
    label: "Backup A — Risks we carry",
    title: "Risks we carry",
    headline: "What we guarantee, and what we do not.",
    bullets: [
      "We guarantee an amount of the settlement stablecoin, not its fiat value after a depeg.",
      "On the deposit path, our executor holds payer funds briefly while sweeping. The contract path avoids this.",
      "Signing keys, oracles, DEX liquidity, RPCs, and issuers are external dependencies. We bound them; we do not remove them.",
      "The deposit forwarder passed static analysis but has not had an adversarial review. Mainnet hardening is a defined programme.",
    ],
    visual: <RiskColumns />,
    notes: [
      "docs/threat-model.md, PURPOSE.md §19. Depeg guard is RFC #71.",
      "Key compromise reduced by KMS/Turnkey signing, timelocked rotation, multisig governance, router pause, Safe allowlists. Mainnet hardening is RFC #143.",
      "Investors read this slide as a maturity signal.",
    ],
    backup: true,
  },
  {
    id: "b",
    label: "Backup B — Claim ledger",
    title: "Claim ledger",
    headline: "Every claim, its status, and where it is written down.",
    bullets: [],
    visual: <ClaimLedger />,
    notes: [
      "Base Sepolia: PaymentRouter 0xEe7c5B5a9eeAf667A6EFb217A8a77534C873f7a9, TimelockController 0x0c006FC14063e3F78271312B975231e4BD6e8B00, DepositForwarderFactory 0x598F64551456BCa2536386ED54A24412E3e32fCe. docs/chain.md.",
    ],
    backup: true,
  },
];
