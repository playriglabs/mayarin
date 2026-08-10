/**
 * Theme toggle — a React island, server-rendered before hydration.
 *
 * The pre-paint script in the layout has already stamped `data-theme` on
 * <html> before any island hydrates. The server renders the dark default, then
 * the effect synchronises the icon with the stored preference in the browser.
 *
 * Dark is the default; the stored value only records an explicit choice.
 */

import { MoonIcon, SunIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { MotionProvider } from "@/lib/motion";

type Theme = "light" | "dark";

function themeNow(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    setTheme(themeNow());
  }, []);

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
        className="size-10 rounded-full border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={toggle}
        aria-label={theme === "dark" ? "Switch to the light theme" : "Switch to the dark theme"}
      >
        {theme === "dark" ? (
          <SunIcon size={20} weight="regular" aria-hidden="true" />
        ) : (
          <MoonIcon size={20} weight="regular" aria-hidden="true" />
        )}
      </Button>
    </MotionProvider>
  );
}
