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
  BankIcon,
  CardholderIcon,
  ChartLineIcon,
  GearSixIcon,
  type Icon,
  PackageIcon,
  ReceiptIcon,
  SquaresFourIcon,
  UsersThreeIcon,
  WalletIcon,
  WebhooksLogoIcon,
} from "@phosphor-icons/react";
import { ICON_NAV } from "@/lib/icons";
import { cn } from "@/lib/utils";
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
}

const PRIMARY: readonly NavItem[] = [
  { href: "/", label: "Overview", icon: SquaresFourIcon },
  { href: "/payments", label: "Payments", icon: ReceiptIcon },
  { href: "/links", label: "Payment links", icon: CardholderIcon, permission: "catalog:manage" },
  { href: "/catalog", label: "Catalog", icon: PackageIcon, permission: "catalog:manage" },
  { href: "/settlement", label: "Settlement", icon: BankIcon },
  { href: "/analytics", label: "Analytics", icon: ChartLineIcon },
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
  { href: "/webhooks", label: "Webhooks", icon: WebhooksLogoIcon, permission: "settings:manage" },
  { href: "/settings", label: "Settings", icon: GearSixIcon, permission: "settings:manage" },
];

const ADMIN: NavItem = {
  href: "/admin",
  label: "Admin",
  icon: UsersThreeIcon,
  permission: "admin:access",
};

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
  const items = [...PRIMARY, ...CONFIGURATION, ADMIN].filter(
    (item) => item.permission === undefined || permissions.includes(item.permission),
  );

  return (
    <nav
      aria-label="Primary"
      className="flex flex-row gap-0.5 overflow-x-auto p-2 md:flex-col md:overflow-x-visible"
    >
      {items.map(({ href, label, icon: IconComponent }) => {
        const active = isActive(href, pathname);
        return (
          <a
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              // 8px padding — the navigation rule. Sharp, like everything else.
              "relative flex shrink-0 items-center gap-2 p-2 text-sm",
              active
                ? "bg-sidebar-accent font-medium text-sidebar-foreground"
                : "font-normal text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
            )}
          >
            {active && (
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 w-0.5 bg-electric max-md:inset-x-0 max-md:top-auto max-md:bottom-0 max-md:h-0.5 max-md:w-auto"
              />
            )}
            <IconComponent
              size={ICON_NAV}
              weight={active ? "fill" : "regular"}
              aria-hidden="true"
              className={active ? "text-electric" : "text-sidebar-muted-foreground"}
            />
            {label}
          </a>
        );
      })}
    </nav>
  );
}
