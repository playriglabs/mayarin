/**
 * The badge on a snippet's title bar, in place of a decorative dot: which
 * language the example is written in is the one useful thing that space can
 * say, and it is read before the filename.
 */
export function LanguageMark({ lang }: { readonly lang: string }) {
  if (lang === "typescript" || lang === "tsx") {
    return (
      <svg
        viewBox="0 0 24 24"
        class="size-4 shrink-0 rounded-[3px]"
        role="img"
        aria-label="TypeScript"
      >
        <rect width="24" height="24" rx="2" fill="#3178c6" />
        <path
          fill="#ffffff"
          d="M13.1 18.6v-2.2q.5.4 1.1.6.6.2 1.3.2.4 0 .7-.08.3-.08.5-.2.2-.13.3-.3.1-.2.1-.4 0-.3-.2-.5-.15-.2-.4-.4-.26-.17-.6-.33-.35-.16-.75-.33-1-.43-1.5-1.05-.5-.62-.5-1.5 0-.7.27-1.2.28-.5.75-.82.48-.33 1.1-.48.63-.16 1.33-.16.7 0 1.2.08.53.08.97.26v2.05q-.22-.15-.48-.26-.26-.11-.53-.18-.27-.07-.54-.1-.26-.04-.5-.04-.37 0-.67.07-.3.07-.5.2-.2.13-.3.31-.12.18-.12.4 0 .26.15.47.15.2.4.38.27.17.63.34.37.16.8.34.52.22.93.46.42.25.7.57.3.32.45.73.16.4.16.96 0 .76-.28 1.27-.28.5-.76.82-.48.32-1.13.46-.64.14-1.36.14-.74 0-1.4-.13-.67-.12-1.16-.38ZM12 9.9H9.3v7.8H7.1V9.9H4.4V8h7.6v1.9Z"
        />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      class="size-4 shrink-0 rounded-[3px]"
      role="img"
      aria-label="Shell script"
    >
      <rect width="24" height="24" rx="2" fill="#1f6f54" />
      <path
        d="m6.5 8.5 3.5 3.5-3.5 3.5M12.5 15.5h5"
        fill="none"
        stroke="#ffffff"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}
