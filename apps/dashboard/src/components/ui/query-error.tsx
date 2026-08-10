import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ICON_NAV } from "@/lib/icons";

interface QueryErrorProps {
  readonly message: string;
  readonly retry: () => void;
  readonly retrying?: boolean;
}

function QueryError({ message, retry, retrying = false }: QueryErrorProps) {
  return (
    <Alert variant="destructive" className="flex flex-wrap items-center justify-between gap-3">
      <span>{message}</span>
      <Button type="button" variant="secondary" size="sm" onClick={retry} disabled={retrying}>
        <ArrowClockwiseIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
        {retrying ? "Retrying…" : "Retry"}
      </Button>
    </Alert>
  );
}

export { QueryError };
