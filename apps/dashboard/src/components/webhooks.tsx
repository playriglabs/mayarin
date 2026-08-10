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

import { ArrowsClockwiseIcon, PlusIcon, WebhooksLogoIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { match } from "ts-pattern";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SectionHeader } from "@/components/ui/section-header";
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
import { withQuery } from "@/lib/with-query";

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
  const deliveries = useWebhookDeliveries(50);
  const create = useCreateWebhookEndpoint();
  const rotate = useRotateWebhookSecret();
  const deactivate = useDeactivateWebhookEndpoint();
  const replay = useReplayDelivery();

  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [failure, setFailure] = useState("");
  const [notice, setNotice] = useState("");

  const endpointRows = endpoints.data?.endpoints ?? [];
  const deliveryRows = deliveries.data?.deliveries ?? [];

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
            <Alert variant="destructive">{reasonOf(error, "endpoints")}</Alert>
          ))
          .otherwise(() =>
            endpointRows.length === 0 ? (
              <Empty>
                <EmptyMedia>
                  <WebhooksLogoIcon size={ICON_CARD} aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>No endpoints yet.</EmptyTitle>
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

        {match(deliveries)
          .with({ isPending: true }, () => <TableSkeleton rows={4} />)
          .with({ isError: true }, ({ error }) => (
            <Alert variant="destructive">{reasonOf(error, "deliveries")}</Alert>
          ))
          .otherwise(() =>
            deliveryRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing has been sent yet.</p>
            ) : (
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
