import { usePathname } from "fumadocs-core/framework";
import type { Item } from "fumadocs-core/page-tree";
import { SidebarItem, useFolderDepth } from "fumadocs-ui/components/sidebar/base";
import type { FC } from "react";
import { ITEM_BASE, ITEM_HIGHLIGHT, ITEM_LINK, isActive, itemOffset } from "./sidebar-style.ts";

// HTTP method badge for the sidebar. The page-tree transformer in
// `lib/source.ts` stamps each API operation node's `icon` with its method
// (e.g. "GET"); this component turns that string into a colored pill and
// renders every other node exactly like the default sidebar item.
//
// `components: { Item: MethodItem }` replaces the default leaf renderer for
// EVERY leaf (authored pages too), so this must reproduce the default item's
// styling — see ./sidebar-style.ts — and only the method icon differs.

const METHODS = new Set(["GET", "POST", "PATCH", "PUT", "DELETE", "HEAD", "OPTIONS"]);

const METHOD_STYLES: Record<string, string> = {
  GET: "text-emerald-700 dark:text-emerald-400",
  POST: "text-blue-700 dark:text-blue-400",
  PATCH: "text-orange-700 dark:text-orange-400",
  PUT: "text-purple-700 dark:text-purple-400",
  DELETE: "text-red-700 dark:text-red-400",
  HEAD: "text-neutral-600 dark:text-neutral-400",
  OPTIONS: "text-neutral-600 dark:text-neutral-400",
};

function MethodBadge({ method }: { readonly method: string }) {
  const className = METHOD_STYLES[method] ?? "text-neutral-600 dark:text-neutral-400";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center font-mono text-[0.6rem] font-semibold uppercase leading-none ${className}`}
      style={{ minWidth: "2.75rem" }}
    >
      {method}
    </span>
  );
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
      className={`${ITEM_BASE} ${ITEM_LINK} ${depth >= 1 ? ITEM_HIGHLIGHT : ""} w-full`}
      style={{ paddingInlineStart: itemOffset(depth) }}
    >
      {item.name}
    </SidebarItem>
  );
};
