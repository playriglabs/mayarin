import { Button } from "@/components/ui/button";

interface CursorPaginationProps {
  readonly label: string;
  readonly page: number;
  readonly canPrevious: boolean;
  readonly nextCursor: string | null | undefined;
  readonly busy: boolean;
  readonly onPrevious: () => void;
  readonly onNext: (cursor: string) => void;
}

export function CursorPagination({
  label,
  page,
  canPrevious,
  nextCursor,
  busy,
  onPrevious,
  onNext,
}: CursorPaginationProps) {
  return (
    <nav aria-label={label} className="flex items-center justify-between gap-3">
      <Button variant="secondary" onClick={onPrevious} disabled={!canPrevious || busy}>
        Previous
      </Button>
      <span className="font-mono text-xs text-muted-foreground">Page {page}</span>
      <Button
        variant="secondary"
        onClick={() => nextCursor != null && onNext(nextCursor)}
        disabled={nextCursor == null || busy}
      >
        Next
      </Button>
    </nav>
  );
}
