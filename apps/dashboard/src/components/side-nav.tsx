/**
 * Primary navigation.
 *
 * Rendered by the layout WITHOUT a client directive: it is a list of links with
 * no client state, so Astro emits static HTML and the browser ships no JS for
 * it. The active item is decided on the server from the request path.
 *
 * Accessibility notes:
 *   - The list is a real `<nav>` with an accessible name, so a screen reader
 *     can jump to it as a landmark.
 *   - The active link carries `aria-current="page"`. The left marker is a
 *     duplicate signal for sighted users, never the only one — the label also
 *     shifts from muted to ink.
 *   - Links are links. Nothing here traps focus or needs a key handler; tab and
 *     enter already work, and reimplementing them would only break them.
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
import { cn } from "@/lib/utils";
import type { Permission } from "@/types/user";

const SIDEBAR_ICON_SIZE = 20;

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

/** `/` matches only itself; every other item matches its own subtree. */
function isActive(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export default function SideNav({
  pathname,
  permissions,
}: {
  pathname: string;
  permissions: readonly Permission[];
}) {
  return (
    <nav
      aria-label="Primary"
      data-sidebar-nav
      className="flex min-h-0 flex-1 flex-col gap-0 overflow-y-auto px-5 py-5"
    >
      {NAV_GROUPS.map((group) => {
        const items = group.items.filter(
          (item) => item.permission === undefined || permissions.includes(item.permission),
        );
        if (items.length === 0) return null;

        return (
          <section
            key={group.label}
            aria-labelledby={`nav-${group.label.toLowerCase()}`}
            data-sidebar-section
            className="block border-sidebar-border border-b py-3 first:pt-0 last:border-b-0 last:pb-0"
          >
            <h2
              id={`nav-${group.label.toLowerCase()}`}
              data-sidebar-section-label
              className="mb-2 block text-xs font-medium tracking-[0.08em] text-sidebar-muted-foreground/65 uppercase"
            >
              {group.label}
            </h2>

            <div className="flex flex-col gap-0.5">
              {items.map(({ href, label, icon: IconComponent, flag }) => {
                const active = isActive(href, pathname);
                return (
                  <a
                    key={href}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    data-sidebar-link
                    title={label}
                    className={cn(
                      "relative flex min-h-10 shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-base transition-colors duration-200",
                      active
                        ? "bg-sidebar-accent font-medium text-sidebar-foreground"
                        : "font-normal text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                    )}
                  >
                    {active && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-sidebar-marker"
                      />
                    )}
                    <IconComponent
                      size={SIDEBAR_ICON_SIZE}
                      weight={active ? "fill" : "regular"}
                      aria-hidden="true"
                      className={active ? "text-sidebar-marker" : "text-sidebar-muted-foreground"}
                    />
                    <span data-sidebar-nav-label>{label}</span>
                    {flag !== undefined && (
                      // The same attribute the label carries, so the collapsed
                      // sidebar hides it by the rule that already exists rather
                      // than by a second one that could drift from it.
                      <span
                        data-sidebar-nav-label
                        className="bg-sidebar-marker/15 px-2 py-px font-medium text-[9px] text-sidebar-marker uppercase tracking-wide"
                      >
                        {flag}
                      </span>
                    )}
                  </a>
                );
              })}
            </div>
          </section>
        );
      })}
    </nav>
  );
}
