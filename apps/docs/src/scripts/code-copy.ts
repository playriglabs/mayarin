/**
 * Copy buttons for authored MDX code blocks.
 *
 * fumadocs' `CodeBlock` renders a React copy button, but an authored page's
 * content is Astro slot content: it is handed to the island as static HTML
 * (inside `<astro-slot>`) and React never owns those nodes, so the button
 * server-renders and then does nothing. Code blocks React itself renders — the
 * API reference playground — hydrate normally and are left alone here, which
 * is what the `<astro-slot>` check selects on.
 *
 * The behaviour mirrors fumadocs': copy the `<pre>` text with `.nd-copy-ignore`
 * nodes turned into newlines, then show a check for 1.5s.
 */

const CHECKED_MS = 1_500;
const COPY_LABEL = "Copy Text";
const COPIED_LABEL = "Copied Text";
const CHECK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>`;

const timers = new WeakMap<HTMLButtonElement, number>();
const icons = new WeakMap<HTMLButtonElement, string>();

function codeText(button: HTMLButtonElement): string | undefined {
  const pre = button.closest("figure")?.querySelector("pre");
  if (pre === null || pre === undefined) return undefined;

  const clone = pre.cloneNode(true) as HTMLElement;
  for (const ignored of clone.querySelectorAll(".nd-copy-ignore")) {
    ignored.replaceWith("\n");
  }
  return clone.textContent ?? "";
}

function markCopied(button: HTMLButtonElement): void {
  const previous = timers.get(button);
  if (previous !== undefined) window.clearTimeout(previous);
  if (!icons.has(button)) icons.set(button, button.innerHTML);

  button.dataset.checked = "true";
  button.setAttribute("aria-label", COPIED_LABEL);
  button.innerHTML = CHECK_ICON;

  timers.set(
    button,
    window.setTimeout(() => {
      delete button.dataset.checked;
      button.setAttribute("aria-label", COPY_LABEL);
      const icon = icons.get(button);
      if (icon !== undefined) button.innerHTML = icon;
      timers.delete(button);
    }, CHECKED_MS),
  );
}

// Delegated, so it covers code blocks swapped in by client-side navigation.
document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const button = target.closest<HTMLButtonElement>(
    `button[aria-label="${COPY_LABEL}"], button[aria-label="${COPIED_LABEL}"]`,
  );
  // React-owned buttons handle their own clicks; only slot content is inert.
  if (button === null || button.closest("astro-slot") === null) return;

  const text = codeText(button);
  if (text === undefined) return;

  void navigator.clipboard.writeText(text).then(() => markCopied(button));
});
