/**
 * Webhooks — a React island over `/webhooks` (#13).
 *
 * Two surfaces that answer different questions. Endpoints: where should we send
 * payment events. Deliveries: what did we actually send, and what did your
 * server say back. A webhook a merchant cannot see is a webhook they will not
 * trust, which is why the delivery table shows the response code and the exact
 * signed body rather than a green tick.
 *
 * The signing secret is returned exactly once — on creation and on rotation —
 * so it is shown in a panel that says so. Nothing re-reads it later, here or
 * anywhere else.
 *
 * Deliveries poll while any is still pending: a retry lands on its own
 * schedule, and a merchant watching one land should not have to reload.
 */

import {
  ArrowsClockwiseIcon,
  PaperPlaneTiltIcon,
  PlusIcon,
  WebhooksLogoIcon,
} from "@phosphor-icons/react";
import { useDeferredValue, useState } from "react";
import { match } from "ts-pattern";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CursorPagination } from "@/components/ui/cursor-pagination";
import { DateRangeFilter } from "@/components/ui/date-range-filter";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyAction,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { QueryError } from "@/components/ui/query-error";
import { SectionHeader } from "@/components/ui/section-header";
import {
  Select,
  SelectContent,
  SelectItem,
  type SelectOption,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TableSkeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCursorPagination } from "@/hooks/cursor-pagination";
import {
  useCreateWebhookEndpoint,
  useDeactivateWebhookEndpoint,
  useReplayDelivery,
  useRotateWebhookSecret,
  useWebhookDeliveries,
  useWebhookEndpoints,
} from "@/hooks/settings";
import { ApiError } from "@/lib/api/client";
import { formatDateTime, isoAttr } from "@/lib/date";
import { ICON_CARD, ICON_NAV } from "@/lib/icons";
import { PAGE_SIZE } from "@/lib/pagination";
import { withQuery } from "@/lib/with-query";
import type { WebhookDeliveryListFilter } from "@/types/settings";

const DELIVERY_STATUS_OPTIONS: readonly SelectOption[] = [
  { value: "all", label: "All statuses" },
  { value: "PENDING", label: "Pending" },
  { value: "DELIVERED", label: "Delivered" },
  { value: "DEAD", label: "Dead" },
];

const DELIVERY_SORT_OPTIONS: readonly SelectOption[] = [
  { value: "-created", label: "Newest first" },
  { value: "created", label: "Oldest first" },
];

/** Delivery statuses that mean "nothing further will be attempted". */
const TERMINAL: readonly string[] = ["DELIVERED", "EXHAUSTED", "FAILED"];

function toneOf(status: string): "success" | "destructive" | "warning" {
  if (status === "DELIVERED") return "success";
  return TERMINAL.includes(status) ? "destructive" : "warning";
}

function reasonOf(error: unknown, what: string): string {
  return error instanceof ApiError ? error.message : `Failed to load ${what}`;
}

function Webhooks() {
  const endpoints = useWebhookEndpoints();
  const create = useCreateWebhookEndpoint();
  const rotate = useRotateWebhookSecret();
  const deactivate = useDeactivateWebhookEndpoint();
  const replay = useReplayDelivery();

  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [failure, setFailure] = useState("");
  const [notice, setNotice] = useState("");
  const [deliveryQuery, setDeliveryQuery] = useState("");
  const [deliveryStatus, setDeliveryStatus] = useState("all");
  const [deliverySort, setDeliverySort] = useState<"created" | "-created">("-created");
  const [deliveryFrom, setDeliveryFrom] = useState("");
  const [deliveryTo, setDeliveryTo] = useState("");
  const deliveryPagination = useCursorPagination();
  const deferredDeliveryQuery = useDeferredValue(deliveryQuery.trim());
  const deliveryFilter: WebhookDeliveryListFilter = {
    limit: PAGE_SIZE,
    ...(deferredDeliveryQuery === "" ? {} : { q: deferredDeliveryQuery }),
    ...(deliveryStatus === "all"
      ? {}
      : { status: deliveryStatus as NonNullable<WebhookDeliveryListFilter["status"]> }),
    sort: deliverySort,
    ...(deliveryFrom === "" ? {} : { from: deliveryFrom }),
    ...(deliveryTo === "" ? {} : { to: deliveryTo }),
  };
  const deliveries = useWebhookDeliveries(deliveryFilter, deliveryPagination.cursor);

  const endpointRows = endpoints.data?.endpoints ?? [];
  const deliveryRows = deliveries.data?.deliveries ?? [];
  // See orders.tsx: `isPending`, so a background poll never greys the filters.
  const filtersBusy = deliveries.isPending;

  async function add() {
    setFailure("");
    try {
      const created = await create.mutateAsync(url.trim());
      setAdding(false);
      setUrl("");
      setSecret(created.secret ?? null);
      setNotice("Endpoint created.");
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Could not create that endpoint");
    }
  }

  async function disableEndpoint(id: string) {
    setFailure("");
    try {
      await deactivate.mutateAsync(id);
      setNotice("Endpoint disabled. Nothing further is sent to it.");
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Could not disable the endpoint");
    }
  }

  async function replayDelivery(id: string) {
    setFailure("");
    try {
      await replay.mutateAsync(id);
      setNotice("Delivery re-queued. It keeps its original Webhook-Id.");
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Could not replay the delivery");
    }
  }

  async function rotateSecret(id: string) {
    setFailure("");
    try {
      const rotated = await rotate.mutateAsync(id);
      setSecret(rotated.secret ?? null);
      setNotice("Secret rotated. The previous one keeps working for the overlap window.");
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Could not rotate the secret");
    }
  }

  return (
    <section className="flex flex-col gap-8">
      <p aria-live="polite" className="sr-only">
        {notice}
      </p>

      {failure !== "" && !adding && <Alert variant="destructive">{failure}</Alert>}

      {secret !== null && (
        <Card className="gap-2">
          <p className="text-sm font-medium">Signing secret — shown once</p>
          <p className="break-all font-mono text-xs">{secret}</p>
          <p className="text-xs text-muted-foreground">
            Store it now. It is never displayed again; rotating issues a new one.
          </p>
          <div>
            <Button variant="secondary" size="sm" onClick={() => setSecret(null)}>
              I have stored it
            </Button>
          </div>
        </Card>
      )}

      <div className="flex flex-col gap-4">
        <SectionHeader
          title="Endpoints"
          action={
            <Button
              size="sm"
              onClick={() => {
                setFailure("");
                setAdding(true);
              }}
            >
              <PlusIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
              Add endpoint
            </Button>
          }
        />

        {match(endpoints)
          .with({ isPending: true }, () => <TableSkeleton rows={2} />)
          .with({ isError: true }, ({ error }) => (
            <QueryError
              message={reasonOf(error, "endpoints")}
              retry={() => void endpoints.refetch()}
              retrying={endpoints.isFetching}
            />
          ))
          .otherwise(() =>
            endpointRows.length === 0 ? (
              <Empty>
                <EmptyMedia>
                  <WebhooksLogoIcon size={ICON_CARD} aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>No endpoints yet.</EmptyTitle>
                <EmptyDescription>
                  Register a URL to receive payment lifecycle events.
                </EmptyDescription>
                <EmptyAction>
                  <Button
                    onClick={() => {
                      setFailure("");
                      setAdding(true);
                    }}
                  >
                    <PlusIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                    Add your first endpoint
                  </Button>
                </EmptyAction>
              </Empty>
            ) : (
              <Table>
                <TableCaption>Where payment events are sent</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>URL</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Added</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {endpointRows.map((endpoint) => (
                    <TableRow key={endpoint.id}>
                      <TableCell className="break-all font-mono text-xs">{endpoint.url}</TableCell>
                      <TableCell>
                        <span className="flex gap-1">
                          <Badge variant={endpoint.active ? "success" : "default"}>
                            {endpoint.active ? "Active" : "Off"}
                          </Badge>
                          {endpoint.rotatedSecretActive && (
                            <Badge variant="warning">Old secret still accepted</Badge>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <time dateTime={isoAttr(endpoint.createdAt)}>
                          {formatDateTime(endpoint.createdAt)}
                        </time>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void rotateSecret(endpoint.id)}
                            disabled={rotate.isPending}
                          >
                            Rotate secret
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void disableEndpoint(endpoint.id)}
                            disabled={!endpoint.active || deactivate.isPending}
                          >
                            Disable
                          </Button>
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ),
          )}
      </div>

      <div className="flex flex-col gap-4">
        <SectionHeader title="Deliveries" />
        <p className="text-sm text-muted-foreground">
          What was sent and what your server answered. A failed delivery retries on its own
          schedule; replaying re-queues it now.
        </p>

        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-56 flex-1">
            <Field>
              <FieldLabel htmlFor="delivery-search">Search</FieldLabel>
              <Input
                id="delivery-search"
                type="search"
                value={deliveryQuery}
                onChange={(event) => {
                  setDeliveryQuery(event.target.value);
                  deliveryPagination.reset();
                }}
                placeholder="Delivery, event, or endpoint id"
              />
            </Field>
          </div>
          <div className="w-full sm:w-44">
            <Field>
              <FieldLabel htmlFor="delivery-status">Status</FieldLabel>
              <Select
                items={DELIVERY_STATUS_OPTIONS}
                value={deliveryStatus}
                onValueChange={(value) => {
                  setDeliveryStatus(value);
                  deliveryPagination.reset();
                }}
              >
                <SelectTrigger id="delivery-status" disabled={filtersBusy}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DELIVERY_STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid w-full grid-cols-2 gap-3 sm:w-auto">
            <DateRangeFilter
              from={deliveryFrom}
              to={deliveryTo}
              disabled={filtersBusy}
              onFromChange={(value) => {
                setDeliveryFrom(value);
                deliveryPagination.reset();
              }}
              onToChange={(value) => {
                setDeliveryTo(value);
                deliveryPagination.reset();
              }}
            />
          </div>
          <div className="w-full sm:w-44">
            <Field>
              <FieldLabel htmlFor="delivery-sort">Sort</FieldLabel>
              <Select
                items={DELIVERY_SORT_OPTIONS}
                value={deliverySort}
                onValueChange={(value) => {
                  setDeliverySort(value as typeof deliverySort);
                  deliveryPagination.reset();
                }}
              >
                <SelectTrigger id="delivery-sort" disabled={filtersBusy}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DELIVERY_SORT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </div>

        {match(deliveries)
          .with({ isPending: true }, () => <TableSkeleton rows={PAGE_SIZE} />)
          .with({ isError: true }, ({ error }) => (
            <QueryError
              message={reasonOf(error, "deliveries")}
              retry={() => void deliveries.refetch()}
              retrying={deliveries.isFetching}
            />
          ))
          .otherwise(() =>
            deliveryRows.length === 0 ? (
              <Empty>
                <EmptyMedia>
                  <PaperPlaneTiltIcon size={ICON_CARD} aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>No deliveries yet.</EmptyTitle>
                <EmptyDescription>
                  Deliveries appear after an endpoint is active and a payment event occurs.
                </EmptyDescription>
                {endpointRows.length === 0 && (
                  <EmptyAction>
                    <Button onClick={() => setAdding(true)}>Add an endpoint</Button>
                  </EmptyAction>
                )}
              </Empty>
            ) : (
              <div className="flex flex-col gap-3">
                <Table>
                  <TableCaption>Recent webhook deliveries</TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Event</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Attempts</TableHead>
                      <TableHead className="text-right">Response</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deliveryRows.map((delivery) => (
                      <TableRow key={delivery.id}>
                        <TableCell className="font-mono text-xs">{delivery.eventId}</TableCell>
                        <TableCell>
                          <Badge variant={toneOf(delivery.status)}>{delivery.status}</Badge>
                        </TableCell>
                        <TableCell className="text-right">{delivery.attempts}</TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {delivery.lastStatusCode ?? delivery.lastError ?? "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          <time dateTime={isoAttr(delivery.createdAt)}>
                            {formatDateTime(delivery.createdAt)}
                          </time>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void replayDelivery(delivery.id)}
                            disabled={replay.isPending}
                          >
                            <ArrowsClockwiseIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                            Replay
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <CursorPagination
                  label="Webhook delivery pages"
                  page={deliveryPagination.page}
                  canPrevious={deliveryPagination.canPrevious}
                  nextCursor={deliveries.data?.nextCursor}
                  busy={deliveries.isFetching}
                  onPrevious={deliveryPagination.previous}
                  onNext={deliveryPagination.next}
                />
              </div>
            ),
          )}
      </div>

      <Dialog open={adding} onOpenChange={(next) => !next && setAdding(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add an endpoint</DialogTitle>
            <DialogDescription>
              Payment events are POSTed here and signed with a secret shown once, on creation.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            {failure !== "" && <Alert variant="destructive">{failure}</Alert>}
            <Field>
              <FieldLabel htmlFor="endpoint-url">URL</FieldLabel>
              <Input
                id="endpoint-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/webhooks/mayarin"
                className="font-mono text-xs"
              />
              <FieldDescription>
                Must be publicly reachable — an address on a private network is refused.
              </FieldDescription>
            </Field>
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="secondary">Cancel</Button>} />
            <Button onClick={add} disabled={url.trim() === "" || create.isPending}>
              Add endpoint
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export default withQuery(Webhooks);
