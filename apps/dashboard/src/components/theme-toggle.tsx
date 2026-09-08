/**
 * Theme toggle — a React island, server-rendered before hydration.
 *
 * The pre-paint script in the layout has already stamped `data-theme` on
 * <html> before any island hydrates. CSS reads that attribute immediately, then
 * the effect synchronises React state with either the stored preference or the
 * operating system when no explicit preference exists.
 */

import { MoonIcon, SunIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { MotionProvider } from "@/lib/motion";

type Theme = "light" | "dark";
const STORAGE_KEY = "mayarin-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function themeNow(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function preferredTheme(stored: string | null, systemDark: boolean): Theme {
  if (stored === "light" || stored === "dark") return stored;
  return systemDark ? "dark" : "light";
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "light" ? "#ffffff" : "#0a0a0a");
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const system = window.matchMedia(DARK_QUERY);
    const syncTheme = () => {
      const next = preferredTheme(localStorage.getItem(STORAGE_KEY), system.matches);
      applyTheme(next);
      setTheme(next);
    };
    const syncStoredTheme = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === null) syncTheme();
    };

    syncTheme();
    system.addEventListener("change", syncTheme);
    window.addEventListener("storage", syncStoredTheme);
    return () => {
      system.removeEventListener("change", syncTheme);
      window.removeEventListener("storage", syncStoredTheme);
    };
  }, []);

  function toggle() {
    const next: Theme = themeNow() === "dark" ? "light" : "dark";
    applyTheme(next);
    localStorage.setItem(STORAGE_KEY, next);
    setTheme(next);
  }

  return (
    <MotionProvider>
      <Button
        variant="ghost"
        size="icon"
        className="size-10 rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={toggle}
        aria-label={theme === "dark" ? "Switch to the light theme" : "Switch to the dark theme"}
      >
        <SunIcon className="hidden dark:block" size={20} weight="regular" aria-hidden="true" />
        <MoonIcon className="dark:hidden" size={20} weight="regular" aria-hidden="true" />
      </Button>
    </MotionProvider>
  );
}
