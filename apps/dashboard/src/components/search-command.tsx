/**
 * Header search: a trigger that looks like an input, and the ⌘K / Ctrl+K
 * palette behind it.
 *
 * The palette lists the same destinations as the sidebar (from
 * `nav-items.ts`, permission-filtered) plus a docs & support link, and is
 * drivable end-to-end from the keyboard: arrows move, Enter opens. Esc and
 * the focus return come from the dialog primitive, not from here.
 */
import { BookOpenTextIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import * as React from "react";
import { NAV_GROUPS, type NavItem } from "@/components/nav-items";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Permission } from "@/types/user";

/** Not a page — the support surface, reachable from search and the header. */
const SUPPORT: NavItem = {
  href: "https://docs.mayarin.xyz",
  label: "Docs & support",
  icon: BookOpenTextIcon,
};

export default function SearchCommand({ permissions }: { permissions: readonly Permission[] }) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const listRef = React.useRef<HTMLDivElement>(null);

  // ⌘ on Apple platforms, Ctrl elsewhere — the trigger chip shows whichever.
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const shortcut = isMac ? "⌘K" : "Ctrl K";

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const items = React.useMemo(() => {
    const pages = NAV_GROUPS.flatMap((group) => group.items).filter(
      (item) => item.permission === undefined || permissions.includes(item.permission),
    );
    const all = [...pages, SUPPORT];
    const needle = query.trim().toLowerCase();
    return needle === "" ? all : all.filter((item) => item.label.toLowerCase().includes(needle));
  }, [permissions, query]);

  // A shorter list than the selection index is a stale selection, not a wrap —
  // clamped at render, so no reset effect is needed when the query changes.
  const activeIndex = Math.min(active, Math.max(items.length - 1, 0));

  React.useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => Math.min(current + 1, items.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      const selected = items[activeIndex];
      if (selected !== undefined) {
        event.preventDefault();
        setOpen(false);
        window.location.assign(selected.href);
      }
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-10 w-36 cursor-pointer items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 text-sm text-subtle-foreground transition-colors hover:bg-muted hover:text-foreground md:w-88"
      >
        <span className="flex min-w-0 items-center gap-2">
          <MagnifyingGlassIcon size={16} aria-hidden="true" className="shrink-0" />
          <span className="hidden truncate sm:inline">Search</span>
        </span>
        <kbd className="shrink-0 rounded-lg border border-border px-1.5 py-0.5 text-[10px] font-medium">
          {shortcut}
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent showCloseButton={false} className="gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <DialogTitle className="sr-only">Search the dashboard</DialogTitle>

          <div className="flex items-center gap-2 border-b border-border px-3">
            <MagnifyingGlassIcon
              size={16}
              aria-hidden="true"
              className="shrink-0 text-subtle-foreground"
            />
            <input
              // The dialog primitive moves focus into the popup; landing it on
              // the input makes the palette usable without a second tab stop.
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder="Search pages…"
              className="h-11 w-full min-w-0 bg-transparent text-sm text-foreground outline-none placeholder:text-subtle-foreground"
            />
            <kbd className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 text-[10px] font-medium text-subtle-foreground">
              Esc
            </kbd>
          </div>

          <div ref={listRef} className="max-h-96 overflow-y-auto p-2">
            {items.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-subtle-foreground">No results.</p>
            ) : (
              items.map((item, index) => {
                const IconComponent = item.icon;
                const external = item.href.startsWith("http");
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    data-index={index}
                    target={external ? "_blank" : undefined}
                    rel={external ? "noreferrer" : undefined}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex min-h-9 items-center gap-3 px-2 py-1.5 text-sm transition-colors",
                      index === activeIndex
                        ? "bg-accent text-accent-foreground"
                        : "text-foreground/80",
                    )}
                  >
                    <IconComponent
                      size={16}
                      aria-hidden="true"
                      className="shrink-0 text-subtle-foreground"
                    />
                    <span className="truncate">{item.label}</span>
                  </a>
                );
              })
            )}
          </div>

          <p className="border-t border-border px-3 py-2 text-xs text-subtle-foreground">
            ↑↓ to navigate · Enter to open · Esc to close
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
