import { useCallback, useState } from "react";

const FIRST_PAGE: readonly (string | undefined)[] = [undefined];

export function useCursorPagination() {
  const [cursors, setCursors] = useState(FIRST_PAGE);

  const reset = useCallback(() => setCursors(FIRST_PAGE), []);
  const previous = useCallback(() => setCursors((current) => current.slice(0, -1)), []);
  const next = useCallback((cursor: string) => {
    setCursors((current) => [...current, cursor]);
  }, []);

  return {
    cursor: cursors.at(-1),
    page: cursors.length,
    canPrevious: cursors.length > 1,
    reset,
    previous,
    next,
  } as const;
}
