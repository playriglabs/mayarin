import clsx from "clsx";
import { usePathname } from "fumadocs-core/framework";
import type { Folder } from "fumadocs-core/page-tree";
import {
  SidebarFolder,
  SidebarFolderContent,
  SidebarFolderLink,
  SidebarFolderTrigger,
  useFolder,
  useFolderDepth,
} from "fumadocs-ui/components/sidebar/base";
import { useTreePath } from "fumadocs-ui/contexts/tree";
import { type FC, useEffect, useRef } from "react";
import {
  FOLDER_CONTENT_GUIDE,
  ITEM_BASE,
  ITEM_BUTTON,
  ITEM_HIGHLIGHT,
  ITEM_LINK,
  isActive,
  itemOffset,
} from "./sidebar-style.ts";

// Sidebar folder that remembers whether the reader collapsed it.
//
// Every navigation swaps the document, so the sidebar island re-mounts and
// fumadocs recomputes each folder's open state from `defaultOpenLevel` and the
// active path — a folder the reader collapsed springs back open. This keeps
// the state in localStorage instead.
//
// `components: { Folder }` replaces the default folder renderer, which means
// re-applying the docs layout's styling (see ./sidebar-style.ts).

const STORAGE_KEY = "mayarin-docs-sidebar-folders";

type FolderState = Record<string, boolean>;

function readState(): FolderState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? {} : (JSON.parse(raw) as FolderState);
  } catch {
    return {};
  }
}

function writeState(id: string, open: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readState(), [id]: open }));
  } catch {
    // Storage disabled (private mode, blocked cookies): fall back to fumadocs'
    // per-page-load default.
  }
}

// Renders nothing: it only bridges the folder's open state to storage. The
// restore runs in an effect rather than during render so the first client
// render still matches the server HTML — no hydration mismatch.
const PersistState: FC<{ readonly id: string }> = ({ id }) => {
  const folder = useFolder();
  const restored = useRef(false);
  const open = folder?.open ?? false;
  const setOpen = folder?.setOpen;

  useEffect(() => {
    if (setOpen === undefined) return;
    if (!restored.current) {
      restored.current = true;
      const stored = readState()[id];
      if (stored !== undefined) {
        if (stored !== open) setOpen(stored);
        return;
      }
    }
    writeState(id, open);
  }, [id, open, setOpen]);

  return null;
};

export const PersistentFolder: FC<{
  readonly item: Folder;
  readonly children: React.ReactNode;
}> = ({ item, children }) => {
  const pathname = usePathname() ?? "";
  const depth = useFolderDepth();
  // A folder holding the current page opens by default, exactly as fumadocs
  // does — a stored "collapsed" then wins in `PersistState`.
  const holdsActivePage = useTreePath().includes(item);
  const id = item.$id ?? item.index?.url ?? String(item.name);
  const collapsible = item.collapsible ?? true;
  const offset = { paddingInlineStart: itemOffset(depth) };

  return (
    <SidebarFolder
      collapsible={collapsible}
      active={holdsActivePage}
      defaultOpen={item.defaultOpen}
    >
      <PersistState id={id} />
      {item.index !== undefined ? (
        <SidebarFolderLink
          href={item.index.url}
          external={item.index.external}
          active={isActive(item.index.url, pathname)}
          className={clsx(ITEM_BASE, ITEM_LINK, depth >= 1 && ITEM_HIGHLIGHT, "w-full")}
          style={offset}
        >
          {item.icon}
          {item.name}
        </SidebarFolderLink>
      ) : (
        <SidebarFolderTrigger
          className={clsx(ITEM_BASE, collapsible && ITEM_BUTTON, "w-full")}
          style={offset}
        >
          {item.icon}
          {item.name}
        </SidebarFolderTrigger>
      )}
      <SidebarFolderContent className={clsx("relative", depth === 0 && FOLDER_CONTENT_GUIDE)}>
        <div className="flex flex-col gap-0.5 pt-0.5">{children}</div>
      </SidebarFolderContent>
    </SidebarFolder>
  );
};
