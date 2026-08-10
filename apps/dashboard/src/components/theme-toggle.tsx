/**
 * Theme toggle — a React island, rendered `client:only`.
 *
 * The pre-paint script in the layout has already stamped `data-theme` on
 * <html> before any island hydrates, so reading it here is safe and the
 * button's icon always matches the paint. Skipping SSR avoids the one
 * mismatch this could produce: the server cannot know the stored theme.
 *
 * Dark is the default; the stored value only records an explicit choice.
 */

import { MoonIcon, SunIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ICON_NAV } from "@/lib/icons";
import { MotionProvider } from "@/lib/motion";

type Theme = "light" | "dark";

function themeNow(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(themeNow);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("mayarin-theme", next);
    setTheme(next);
  }

  return (
    <MotionProvider>
      <Button
        variant="ghost"
        size="icon"
        className="text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
        onClick={toggle}
        aria-label={theme === "dark" ? "Switch to the light theme" : "Switch to the dark theme"}
      >
        {theme === "dark" ? (
          <SunIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
        ) : (
          <MoonIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
        )}
      </Button>
    </MotionProvider>
  );
}
