/**
 * The kinds of money movement a use case card can show. Each has one visual in
 * `use-cases.tsx`, so an industry picks the movements that fit it rather than
 * drawing its own illustration.
 */
export type SolutionKind = "checkout" | "payouts" | "invoice" | "recurring" | "api" | "counter";

export interface Solution {
  readonly kind: SolutionKind;
  /** The small label above the title, naming the movement. */
  readonly label: string;
  readonly title: string;
  readonly body: string;
}

/**
 * One industry, two solutions: how it gets paid, and how it pays out or what
 * it runs alongside. Only what Mayarin ships today — collection on any
 * supported asset, invoices, subscriptions, x402 and batch stablecoin payouts.
 */
export interface Industry {
  readonly id: string;
  readonly name: string;
  readonly solutions: readonly [Solution, Solution];
}

const PAYOUTS_LABEL = "Payouts";

export const INDUSTRIES: readonly Industry[] = [
  {
    id: "e-commerce",
    name: "E-Commerce",
    solutions: [
      {
        kind: "checkout",
        label: "Checkout",
        title: "Checkout in any supported asset",
        body: "Price in your local currency. Shoppers pay in the crypto they hold, you settle in a stablecoin.",
      },
      {
        kind: "payouts",
        label: PAYOUTS_LABEL,
        title: "Pay sellers and affiliates",
        body: "Send stablecoins to up to 100 sellers, affiliates and partners in one transaction.",
      },
    ],
  },
  {
    id: "travel",
    name: "Travel & Hospitality",
    solutions: [
      {
        kind: "checkout",
        label: "Bookings",
        title: "Take bookings at a locked rate",
        body: "The rate is frozen when the traveller checks out, so the fare they saw is the fare you receive.",
      },
      {
        kind: "payouts",
        label: PAYOUTS_LABEL,
        title: "Settle with travel partners",
        body: "Pay agents, hotels and suppliers in stablecoins, wherever they are.",
      },
    ],
  },
  {
    id: "gaming",
    name: "Gaming",
    solutions: [
      {
        kind: "checkout",
        label: "Checkout",
        title: "Top-ups and in-game purchases",
        body: "Players pay from their own wallets. A confirmed payment is final, with no chargebacks.",
      },
      {
        kind: "payouts",
        label: PAYOUTS_LABEL,
        title: "Pay players and creators",
        body: "Reward players, creators and marketplace sellers in one batch.",
      },
    ],
  },
  {
    id: "professional-services",
    name: "Professional Services",
    solutions: [
      {
        kind: "invoice",
        label: "Invoicing",
        title: "Invoice clients abroad",
        body: "Send numbered invoices with your own reference and get a receipt for every payment.",
      },
      {
        kind: "recurring",
        label: "Retainers",
        title: "Bill retainers every month",
        body: "Set a retainer once. Each cycle becomes an invoice the client pays in any supported asset.",
      },
    ],
  },
  {
    id: "freelancers",
    name: "Freelancers & Agencies",
    solutions: [
      {
        kind: "invoice",
        label: "Invoicing",
        title: "Get paid by clients anywhere",
        body: "Invoice in your own currency. Clients pay from any country in the crypto they hold, and you keep a receipt for every payment.",
      },
      {
        kind: "payouts",
        label: PAYOUTS_LABEL,
        title: "Pay your subcontractors",
        body: "Pay designers, developers and contractors across borders in stablecoins, all in one transaction.",
      },
    ],
  },
  {
    id: "trading",
    name: "Trading Platforms",
    solutions: [
      {
        kind: "checkout",
        label: "Deposits",
        title: "Fund accounts from any asset",
        body: "Users fund their accounts from any supported asset, credited once the deposit confirms.",
      },
      {
        kind: "payouts",
        label: "Withdrawals",
        title: "Process withdrawals in batches",
        body: "Send stablecoin withdrawals to up to 100 users in one transaction.",
      },
    ],
  },
  {
    id: "creators",
    name: "Content Creators",
    solutions: [
      {
        kind: "checkout",
        label: "Payment links",
        title: "Tips, commissions and digital work",
        body: "Share one link from your bio or stream. Fans pay in the crypto they hold, priced in your currency.",
      },
      {
        kind: "payouts",
        label: PAYOUTS_LABEL,
        title: "Split earnings with your team",
        body: "Pay editors, collaborators and affiliates in stablecoins, all in one transaction.",
      },
    ],
  },
  {
    id: "saas",
    name: "SaaS & Memberships",
    solutions: [
      {
        kind: "recurring",
        label: "Subscriptions",
        title: "Bill every cycle",
        body: "Charge weekly, monthly or yearly. Each cycle is an invoice the customer pays in any supported asset.",
      },
      {
        kind: "invoice",
        label: "Invoicing",
        title: "Invoices and receipts",
        body: "Every payment comes with a numbered invoice and a receipt your finance team can file.",
      },
    ],
  },
  {
    id: "fintech",
    name: "Fintech Wallets",
    solutions: [
      {
        kind: "checkout",
        label: "Wallet payments",
        title: "Spend a balance at any merchant",
        body: "Turn a user's balance into a payment at any Mayarin merchant. Clearing happens server-side, not in your app.",
      },
      {
        kind: "payouts",
        label: PAYOUTS_LABEL,
        title: "Distribute funds to users",
        body: "Send stablecoins to many user wallets in one transaction.",
      },
    ],
  },
  {
    id: "agents",
    name: "AI Agents & APIs",
    solutions: [
      {
        kind: "api",
        label: "Pay per call",
        title: "Charge for each API call",
        body: "Price one endpoint and let it collect per call. No API key to issue, no plan to meter, no invoice.",
      },
      {
        kind: "api",
        label: "Agent payments",
        title: "One signature to pay",
        body: "An agent signs one authorization for an exact amount. It never registers, holds gas or sees an address.",
      },
    ],
  },
  {
    id: "retail",
    name: "Retail",
    solutions: [
      {
        kind: "counter",
        label: "In person",
        title: "QR at the counter",
        body: "A static merchant QR or a code per payment, settled the same way as an online order.",
      },
      {
        kind: "checkout",
        label: "Storefront plugins",
        title: "Add crypto to your shop",
        body: "Plug into your existing store. Signed webhooks confirm each order, so you never trust a redirect.",
      },
    ],
  },
  {
    id: "trade",
    name: "Trade",
    solutions: [
      {
        kind: "invoice",
        label: "Invoicing",
        title: "Invoice buyers abroad",
        body: "Buyers pay from anywhere in the asset they hold. You receive your stablecoin.",
      },
      {
        kind: "payouts",
        label: PAYOUTS_LABEL,
        title: "Pay suppliers globally",
        body: "Pay suppliers and distributors across borders in one transaction.",
      },
    ],
  },
];
