import { useCallback, useEffect, useState } from "react";

/**
 * Tab state kept in the URL, so a reload lands where the reader was.
 *
 * `replaceState` rather than `pushState`: switching a tab is not navigation,
 * and a merchant who read three tabs should not have to press Back three times
 * to leave the page.
 *
 * An unknown or missing parameter falls back rather than rendering an empty
 * panel — a hand-typed `?tab=nonsense` is a typo, not a state worth honouring.
 */
export function useUrlTab<T extends string>(
  param: string,
  allowed: readonly T[],
  fallback: T,
): readonly [T, (next: T) => void] {
  const read = useCallback((): T => {
    // Guarded for the server pass: this is an Astro island, so the first render
    // can happen where there is no `window` to read a URL from.
    if (typeof window === "undefined") return fallback;
    const value = new URLSearchParams(window.location.search).get(param);
    return allowed.includes(value as T) ? (value as T) : fallback;
  }, [param, allowed, fallback]);

  const [tab, setTab] = useState<T>(read);

  // The URL is the source of truth, so Back and Forward move the tabs too.
  useEffect(() => {
    const onPopState = () => setTab(read());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [read]);

  const select = useCallback(
    (next: T) => {
      setTab(next);
      const url = new URL(window.location.href);
      url.searchParams.set(param, next);
      window.history.replaceState(window.history.state, "", url);
    },
    [param],
  );

  return [tab, select];
}
