/**
 * The dashboard's navigation, as data.
 *
 * Kept in its own module — not inside `side-nav.tsx` — so the search palette
 * (a client component) can list the same destinations without pulling the
 * sidebar's markup into the browser bundle.
 */
import {
  AddressBookIcon,
  BankIcon,
  CardholderIcon,
  ChartLineIcon,
  FileTextIcon,
  GearSixIcon,
  GlobeIcon,
  type Icon,
  KeyIcon,
  LightningIcon,
  PackageIcon,
  ReceiptIcon,
  ShoppingCartIcon,
  SquaresFourIcon,
  UsersThreeIcon,
  WalletIcon,
  WebhooksLogoIcon,
} from "@phosphor-icons/react";
import type { Permission } from "@/types/user";

interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: Icon;
  /**
   * The permission this item's page needs, when it needs one.
   *
   * The backend refuses without it and the middleware redirects, so an item
   * shown to an account that lacks the permission is a link to a bounce. It is
   * declared here rather than assumed, because `catalog:manage` is newer than
   * some accounts: every merchant seeded before it exists has none.
   */
  readonly permission?: Permission;
  /**
   * A short flag beside the label — "NEW" and nothing longer.
   *
   * Deliberately not the shared `Badge`: its variants are coloured for the page
   * surface rather than for this one. `sidebar-marker` is the green this
   * sidebar already uses for the active item — forest on paper, electric on
   * void — so the chip stays readable in both themes without a second rule.
   */
  readonly flag?: string;
}

interface NavGroup {
  readonly label: string;
  readonly items: readonly NavItem[];
}

const PRIMARY: readonly NavItem[] = [
  { href: "/", label: "Overview", icon: SquaresFourIcon },
  { href: "/payments", label: "Payments", icon: ReceiptIcon },
  { href: "/orders", label: "Orders", icon: ShoppingCartIcon },
  { href: "/invoices", label: "Invoices", icon: FileTextIcon, permission: "catalog:manage" },
  { href: "/links", label: "Payment links", icon: CardholderIcon, permission: "catalog:manage" },
  { href: "/catalog", label: "Catalog", icon: PackageIcon, permission: "catalog:manage" },
  { href: "/customers", label: "Customers", icon: AddressBookIcon, permission: "catalog:manage" },
  { href: "/settlement", label: "Settlement", icon: BankIcon },
  { href: "/analytics", label: "Analytics", icon: ChartLineIcon },
];

/**
 * Developers — the surfaces an integration touches: bearer API keys, webhook
 * endpoints, and the event timeline they are built on. Grouped apart from
 * day-to-day commerce because a merchant setting up a POS visits them once, not
 * every shift.
 */
const DEVELOPERS: readonly NavItem[] = [
  { href: "/api-keys", label: "API keys", icon: KeyIcon, permission: "settings:manage" },
  { href: "/webhooks", label: "Webhooks", icon: WebhooksLogoIcon, permission: "settings:manage" },
  { href: "/event-logs", label: "Event logs", icon: LightningIcon, permission: "payments:read" },
  {
    href: "/x402",
    label: "Agent endpoints",
    icon: GlobeIcon,
    permission: "catalog:manage",
    flag: "New",
  },
];

/**
 * Configuration, kept below the day-to-day items.
 *
 * Wallets and settings decide where money lands and are visited once and then
 * rarely; putting them next to Payments would give a surface a merchant opens
 * every hour the same weight as one they open on setup day.
 */
const CONFIGURATION: readonly NavItem[] = [
  { href: "/wallets", label: "Wallets", icon: WalletIcon, permission: "settings:manage" },
  { href: "/settings", label: "Settings", icon: GearSixIcon, permission: "settings:manage" },
];

const ADMIN: NavItem = {
  href: "/admin",
  label: "Admin",
  icon: UsersThreeIcon,
  permission: "admin:access",
};

const NAV_GROUPS: readonly NavGroup[] = [
  { label: "Menu", items: PRIMARY },
  { label: "Developers", items: DEVELOPERS },
  { label: "Tools", items: [...CONFIGURATION, ADMIN] },
];

export type { NavGroup, NavItem };
export { NAV_GROUPS };
