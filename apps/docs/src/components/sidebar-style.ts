// Sidebar item styling, copied from fumadocs-ui's docs sidebar slot
// (`fumadocs-ui/dist/layouts/docs/slots/sidebar.js`). That slot styles the
// unstyled `SidebarItem` / `SidebarFolder*` primitives with an `itemVariants`
// cva that it does not export, so any component we substitute through
// `sidebar.components` has to re-apply the classes itself. Keep in sync if
// fumadocs restyles the sidebar.

export const ITEM_BASE =
  "relative flex flex-row items-center gap-2 rounded-lg p-2 text-start text-fd-muted-foreground wrap-anywhere [&_svg]:size-4 [&_svg]:shrink-0";

// itemVariants({ variant: "link" })
export const ITEM_LINK =
  "transition-colors hover:bg-fd-accent/50 hover:text-fd-accent-foreground/80 hover:transition-none data-[active=true]:bg-fd-primary/10 data-[active=true]:text-fd-primary data-[active=true]:hover:transition-colors";

// itemVariants({ variant: "button" })
export const ITEM_BUTTON =
  "transition-colors hover:bg-fd-accent/50 hover:text-fd-accent-foreground/80 hover:transition-none";

// itemVariants({ highlight: true }) — the active bar drawn inside nested levels.
export const ITEM_HIGHLIGHT =
  "data-[active=true]:before:content-[''] data-[active=true]:before:bg-fd-primary data-[active=true]:before:absolute data-[active=true]:before:w-px data-[active=true]:before:inset-y-2.5 data-[active=true]:before:inset-s-2.5";

// The vertical guide line drawn beside a top-level folder's children.
export const FOLDER_CONTENT_GUIDE =
  "before:content-[''] before:absolute before:w-px before:inset-y-1 before:bg-fd-border before:inset-s-2.5";

// Mirrors `getItemOffset` from the same slot: indent each nesting level.
export function itemOffset(depth: number): string {
  return `calc(${2 + 3 * depth} * var(--spacing))`;
}

export function isActive(href: string, pathname: string): boolean {
  const norm = (value: string) =>
    value.length > 1 && value.endsWith("/") ? value.slice(0, -1) : value;
  return norm(href) === norm(pathname);
}
