import { usePathname } from "fumadocs-core/framework";
import type { Item } from "fumadocs-core/page-tree";
import { SidebarItem, useFolderDepth } from "fumadocs-ui/components/sidebar/base";
import type { FC } from "react";

// HTTP method badge for the sidebar. The page-tree transformer in
// `lib/source.ts` stamps each API operation node's `icon` with its method
// (e.g. "GET"); this component turns that string into a colored pill and
// renders every other node exactly like the default sidebar item.
//
// `components: { Item: MethodItem }` replaces the default leaf renderer for
// EVERY leaf (authored pages too), so this must reproduce the default item's
// styling — the docs layout wraps the base `SidebarItem` with `itemVariants`
// (padding, gap, hover, active bar) in an unexported slot, and the base
// `SidebarItem` we import here adds none of it. We re-apply those classes +
// the per-depth indent so authored pages keep their look and only the method
// icon differs.

const METHODS = new Set(["GET", "POST", "PATCH", "PUT", "DELETE", "HEAD", "OPTIONS"]);

const METHOD_STYLES: Record<string, string> = {
  GET: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-400",
  POST: "bg-blue-100 text-blue-700 dark:bg-blue-950/70 dark:text-blue-400",
  PATCH: "bg-orange-100 text-orange-700 dark:bg-orange-950/70 dark:text-orange-400",
  PUT: "bg-purple-100 text-purple-700 dark:bg-purple-950/70 dark:text-purple-400",
  DELETE: "bg-red-100 text-red-700 dark:bg-red-950/70 dark:text-red-400",
  HEAD: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
  OPTIONS: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
};

// Mirrors `itemVariants({ variant: "link", highlight: depth >= 1 })` from
// fumadocs-ui's docs sidebar slot. Keep in sync if fumadocs restyles sidebar
// links.
const ITEM_BASE =
  "relative flex flex-row items-center gap-2 rounded-lg p-2 text-start text-fd-muted-foreground wrap-anywhere [&_svg]:size-4 [&_svg]:shrink-0 transition-colors hover:bg-fd-accent/50 hover:text-fd-accent-foreground/80 hover:transition-none data-[active=true]:bg-fd-primary/10 data-[active=true]:text-fd-primary data-[active=true]:hover:transition-colors";
const ITEM_HIGHLIGHT =
  "data-[active=true]:before:content-[''] data-[active=true]:before:bg-fd-primary data-[active=true]:before:absolute data-[active=true]:before:w-px data-[active=true]:before:inset-y-2.5 data-[active=true]:before:inset-s-2.5";

function MethodBadge({ method }: { readonly method: string }) {
  const className =
    METHOD_STYLES[method] ??
    "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-xs px-1.5 py-0.5 font-mono text-[0.6rem] font-semibold uppercase leading-none ${className}`}
      style={{ minWidth: "2.75rem" }}
    >
      {method}
    </span>
  );
}

function isActive(href: string, pathname: string): boolean {
  const norm = (s: string) => (s.length > 1 && s.endsWith("/") ? s.slice(0, -1) : s);
  return norm(href) === norm(pathname);
}

// Mirrors `getItemOffset` from the same slot: indent each nesting level.
function itemOffset(depth: number): string {
  return `calc(${2 + 3 * depth} * var(--spacing))`;
}

export const MethodItem: FC<{ readonly item: Item }> = ({ item }) => {
  const pathname = usePathname();
  const depth = useFolderDepth();
  const method = typeof item.icon === "string" && METHODS.has(item.icon) ? item.icon : undefined;

  return (
    <SidebarItem
      href={item.url}
      external={item.external}
      active={isActive(item.url, pathname ?? "")}
      icon={method !== undefined ? <MethodBadge method={method} /> : item.icon}
      className={`${ITEM_BASE} ${depth >= 1 ? ITEM_HIGHLIGHT : ""} w-full`}
      style={{ paddingInlineStart: itemOffset(depth) }}
    >
      {item.name}
    </SidebarItem>
  );
};
