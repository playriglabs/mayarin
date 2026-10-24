import type { JSX } from "preact";

/** Where every "Book demo" button goes, and the page it falls back to without the popup. */
export const BOOK_DEMO_URL = "https://calendly.com/ryzxkzky-proton/30min";

const WIDGET_CSS = "https://assets.calendly.com/assets/external/widget.css";
const WIDGET_JS = "https://assets.calendly.com/assets/external/widget.js";

declare global {
  interface Window {
    Calendly?: { initPopupWidget: (options: { url: string }) => void };
  }
}

/**
 * Loads Calendly on the first click instead of on every page view, so the
 * landing ships no third-party script a visitor never asked for.
 */
function loadWidget(): Promise<void> {
  return new Promise((resolve, reject) => {
    const style = document.createElement("link");
    style.rel = "stylesheet";
    style.href = WIDGET_CSS;
    document.head.appendChild(style);

    const script = document.createElement("script");
    script.src = WIDGET_JS;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Calendly failed to load"));
    document.head.appendChild(script);
  });
}

/**
 * Click handler for a Book demo link. Opens the calendar as a popup; if the
 * widget cannot load, the link's own `href` takes the visitor to Calendly.
 */
export function openBookDemo(event: JSX.TargetedMouseEvent<HTMLAnchorElement>): void {
  event.preventDefault();
  const open = () => window.Calendly?.initPopupWidget({ url: BOOK_DEMO_URL });
  if (window.Calendly) {
    open();
    return;
  }
  loadWidget()
    .then(open)
    .catch(() => window.location.assign(BOOK_DEMO_URL));
}
