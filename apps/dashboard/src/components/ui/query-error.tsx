import { ArrowClockwiseIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyAction,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ICON_CARD, ICON_NAV } from "@/lib/icons";

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

/**
 * A data table that could not load, drawn as the empty state the table would otherwise
 * show: the reason in the description and Retry as the action. The red banner stays for
 * everything that is not a table (a form, a card, a detail view).
 */
function TableError({ message, retry, retrying = false }: QueryErrorProps) {
  return (
    <Empty role="alert">
      <EmptyMedia>
        <WarningCircleIcon size={ICON_CARD} aria-hidden="true" />
      </EmptyMedia>
      <EmptyTitle>Could not load this.</EmptyTitle>
      <EmptyDescription>{message}</EmptyDescription>
      <EmptyAction>
        <Button type="button" variant="secondary" size="sm" onClick={retry} disabled={retrying}>
          <ArrowClockwiseIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
          {retrying ? "Retrying…" : "Retry"}
        </Button>
      </EmptyAction>
    </Empty>
  );
}

export { QueryError, TableError };
