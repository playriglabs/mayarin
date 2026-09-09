import { useEffect, useState } from "react";

/**
 * Just enough routing for a three-page storefront: pushState for in-app
 * navigation, popstate for the browser's back button. Anchor navigation
 * (`/#koleksi`, `/#tentang`) stays with plain `<a>` elements.
 */

export function currentLocation(): string {
  return window.location.pathname + window.location.search;
}

export function navigate(to: string): void {
  window.history.pushState(null, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useLocation(): string {
  const [location, setLocation] = useState(currentLocation);
  useEffect(() => {
    const sync = () => setLocation(currentLocation());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  return location;
}
