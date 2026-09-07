import { ArrowLineLeftIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "mayarin-sidebar-collapsed";

function collapsedNow(): boolean {
  return document.documentElement.dataset.sidebarCollapsed === "true";
}

export default function SidebarToggle() {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(collapsedNow());
  }, []);

  function toggleSidebar() {
    const next = !collapsed;
    document.documentElement.dataset.sidebarCollapsed = String(next);
    localStorage.setItem(STORAGE_KEY, String(next));
    setCollapsed(next);
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="hidden size-10 text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground md:inline-flex"
      onClick={toggleSidebar}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-expanded={!collapsed}
      aria-controls="dashboard-sidebar"
    >
      <ArrowLineLeftIcon
        size={20}
        weight="bold"
        aria-hidden="true"
        className={
          collapsed
            ? "rotate-180 transition-transform duration-200"
            : "transition-transform duration-200"
        }
      />
    </Button>
  );
}
