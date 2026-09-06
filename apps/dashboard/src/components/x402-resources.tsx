/**
 * x402 resources — what an agent can buy from this merchant (#208).
 *
 * A resource is one URL with a price. An agent that requests it without paying
 * gets a `402` carrying the price and the rails, pays, and gets the response —
 * no account, no card, one signature.
 *
 * The form never asks for a payout address. Rails come from `/rails`, which
 * lists only chains where this merchant already has a verified wallet, and the
 * address is filled from it. A merchant with no verified wallet is told to link
 * one rather than offered a text field: a typo there sends every payment on
 * that rail somewhere nobody controls, and it cannot be taken back.
 */

import {
  ArrowSquareOutIcon,
  GlobeIcon,
  PlusIcon,
  TerminalWindowIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { match } from "ts-pattern";
import { ChainLabel } from "@/components/chain-logo";
import { Alert } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QueryError } from "@/components/ui/query-error";
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
  useCreateX402Resource,
  useDeleteX402Resource,
  useX402Rails,
  useX402Resources,
} from "@/hooks/x402";
import { ApiError } from "@/lib/api/client";
import { ICON_CARD, ICON_NAV } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { withQuery } from "@/lib/with-query";
import type { X402ResourceDto } from "@/types/x402";

function reasonOf(error: unknown): string {
  return error instanceof ApiError ? error.message : "Failed to load agent endpoints";
}

/**
 * The documentation, which is where the full gate implementation lives.
 *
 * A constant rather than configuration: the docs site is the same for every
 * deployment of this dashboard, and a broken link here is worse than a
 * hard-coded one.
 */
const DOCS_URL = "https://docs.mayarin.xyz";

function X402Resources() {
  const resources = useX402Resources();
  const rails = useX402Rails();
  const create = useCreateX402Resource();
  const remove = useDeleteX402Resource();

  const [creating, setCreating] = useState(false);
  const [id, setId] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [chains, setChains] = useState<Set<string>>(new Set());
  const [failure, setFailure] = useState("");
  const [guide, setGuide] = useState<X402ResourceDto | null>(null);
  const [pendingRemove, setPendingRemove] = useState<X402ResourceDto | null>(null);

  const offered = rails.data?.rails ?? [];
  const rows = resources.data?.resources ?? [];
  const canCreate =
    id.trim() !== "" && url.trim() !== "" && amount.trim() !== "" && chains.size > 0;

  const toggleChain = (chain: string) => {
    setChains((current) => {
      const next = new Set(current);
      if (next.has(chain)) next.delete(chain);
      else next.add(chain);
      return next;
    });
    setFailure("");
  };

  const open = () => {
    setFailure("");
    setId("");
    setUrl("");
    setDescription("");
    setAmount("");
    // One rail is the common case, and pre-selecting the only one there is
    // saves a click without ever choosing between two.
    setChains(new Set(offered.length === 1 ? offered.map((rail) => rail.chain) : []));
    setCreating(true);
  };

  const save = async () => {
    try {
      const created = await create.mutateAsync({
        id: id.trim(),
        url: url.trim(),
        ...(description.trim() === "" ? {} : { description: description.trim() }),
        // The merchant's own currency, priced the way every other price on this
        // dashboard is: what the payer sends is worked out per rail at request
        // time, not stored here.
        price: { amount: amount.trim(), asset: "USD" },
        maxTimeoutSeconds: 60,
        chains: [...chains],
      });
      setCreating(false);
      // Registering prices the endpoint; it does not make the merchant's own
      // server ask for payment. Showing the guide unprompted is the difference
      // between a row in a table and a working gate.
      setGuide(created.resource);
    } catch (error) {
      setFailure(reasonOf(error));
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-xs text-subtle-foreground">
          {rows.length} endpoint{rows.length === 1 ? "" : "s"}
        </p>
        <Button onClick={open} disabled={offered.length === 0}>
          <PlusIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
          New endpoint
        </Button>
      </div>

      {rails.isSuccess && offered.length === 0 && (
        <Alert>
          Nothing can be offered yet: an agent pays your own address, and none is verified on a
          supported chain. Link and verify a wallet under Wallets first.
        </Alert>
      )}

      {failure !== "" && !creating && <Alert variant="destructive">{failure}</Alert>}

      {match(resources)
        .with({ isPending: true }, () => <TableSkeleton rows={5} />)
        .with({ isError: true }, ({ error }) => (
          <QueryError
            message={reasonOf(error)}
            retry={() => void resources.refetch()}
            retrying={resources.isFetching}
          />
        ))
        .otherwise(() =>
          rows.length === 0 ? (
            <Empty>
              <EmptyMedia>
                <GlobeIcon size={ICON_CARD} aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>Nothing is sold to agents yet.</EmptyTitle>
              <EmptyDescription>
                Register an endpoint and its price. An agent that calls it without paying is told
                what it costs and where to pay.
              </EmptyDescription>
              <EmptyAction>
                <Button onClick={open} disabled={offered.length === 0}>
                  <PlusIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                  Register your first endpoint
                </Button>
              </EmptyAction>
            </Empty>
          ) : (
            <Table>
              <TableCaption>Endpoints agents can pay for</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Rails</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((resource) => (
                  <TableRow key={resource.id}>
                    <TableCell>
                      <span className="font-mono text-xs text-foreground">{resource.id}</span>
                      {resource.description !== undefined && (
                        <p className="text-xs text-subtle-foreground">{resource.description}</p>
                      )}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                      {resource.url}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{resource.price.display}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        {resource.accepts.map((accept) => (
                          <Badge key={`${accept.chain}-${accept.asset}`} variant="default">
                            <ChainLabel chain={accept.chain} /> · {accept.asset}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setGuide(resource)}
                          aria-label={`How to gate ${resource.id}`}
                        >
                          <TerminalWindowIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setPendingRemove(resource)}
                          aria-label={`Remove ${resource.id}`}
                        >
                          <TrashIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ),
        )}

      <Dialog open={creating} onOpenChange={(next) => !next && setCreating(false)}>
        <DialogContent className="max-h-[calc(100vh-2rem)] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New agent endpoint</DialogTitle>
            <DialogDescription>
              One endpoint, one price. An agent is charged per request and pays your own verified
              address — which is why there is no address to type here.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            {failure !== "" && <Alert variant="destructive">{failure}</Alert>}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="x402-id">Endpoint id</FieldLabel>
                <Input
                  id="x402-id"
                  value={id}
                  onChange={(e) => {
                    setId(e.target.value);
                    setFailure("");
                  }}
                  placeholder="fx-quote"
                  autoComplete="off"
                  spellCheck={false}
                />
                <FieldDescription>Lowercase, digits and hyphens.</FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor="x402-price">Price</FieldLabel>
                <div className="relative">
                  <Input
                    id="x402-price"
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      setFailure("");
                    }}
                    inputMode="decimal"
                    placeholder="0.02"
                    className="pr-12"
                  />
                  <span className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-3 font-mono text-subtle-foreground text-xs">
                    USD
                  </span>
                </div>
                <FieldDescription>Charged per request.</FieldDescription>
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="x402-url">URL</FieldLabel>
              <Input
                id="x402-url"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setFailure("");
                }}
                placeholder="https://api.example.com/quote"
                autoComplete="off"
                spellCheck={false}
              />
              <FieldDescription>
                The endpoint an agent calls. It is told the price on the first unpaid request.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="x402-description">Description</FieldLabel>
              <Input
                id="x402-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="One oracle-guarded FX quote"
              />
              <FieldDescription>
                Optional. Shown to an agent browsing what you sell.
              </FieldDescription>
            </Field>

            <FieldSet>
              <FieldLegend className="mb-1">Paid on</FieldLegend>
              <FieldDescription className="mb-3">
                Your verified addresses. Choose one or more networks an agent may pay over.
              </FieldDescription>
              <div className="flex flex-col gap-2">
                {offered.map((rail) => {
                  const inputId = `x402-rail-${rail.chain}`;
                  const selected = chains.has(rail.chain);
                  return (
                    <Label
                      key={rail.chain}
                      htmlFor={inputId}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 border p-3 transition-colors",
                        selected
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-subtle-foreground",
                      )}
                    >
                      <Checkbox
                        id={inputId}
                        checked={selected}
                        onCheckedChange={() => toggleChain(rail.chain)}
                        disabled={create.isPending}
                      />
                      {/* min-w-0 so the address truncates instead of pushing the
                          row wider than the dialog — a 42-character hex string
                          is longer than any sensible modal. */}
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="flex items-center gap-2 text-foreground text-sm">
                          <ChainLabel chain={rail.chain} />
                          <Badge variant="default">{rail.asset}</Badge>
                        </span>
                        <span
                          className="truncate font-mono text-subtle-foreground text-xs"
                          title={rail.payTo}
                        >
                          {rail.payTo}
                        </span>
                      </span>
                    </Label>
                  );
                })}
              </div>
            </FieldSet>
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="secondary">Cancel</Button>} />
            <Button onClick={() => void save()} disabled={!canCreate || create.isPending}>
              Register endpoint
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={guide !== null} onOpenChange={(next) => !next && setGuide(null)}>
        <DialogContent className="max-h-[calc(100vh-2rem)] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Make your server ask for payment</DialogTitle>
            <DialogDescription>
              Mayarin now knows what <span className="font-mono text-foreground">{guide?.id}</span>{" "}
              costs and where you are paid — but your own server still answers every request for
              free. These three steps are what turn it into a gate.
            </DialogDescription>
          </DialogHeader>

          <ol className="flex list-decimal flex-col gap-2 pl-5 text-muted-foreground text-sm">
            <li>
              A request with no payment: fetch the price from Mayarin and return{" "}
              <span className="font-mono text-foreground">402</span> carrying it.
            </li>
            <li>
              A request carrying{" "}
              <span className="font-mono text-foreground">PAYMENT-SIGNATURE</span>: verify it, then
              settle it — in that order, because a response cannot be un-served.
            </li>
            <li>Only then serve the content.</li>
          </ol>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setGuide(null)}>
              Done
            </Button>
            <a
              href={`${DOCS_URL}/guides/x402`}
              target="_blank"
              rel="noreferrer noopener"
              className={buttonVariants()}
            >
              Go to documentation
              <ArrowSquareOutIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
            </a>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={pendingRemove !== null}
        onOpenChange={(next) => !next && setPendingRemove(null)}
      >
        <AlertDialogContent className="max-w-md gap-6 p-6">
          <AlertDialogHeader className="gap-2">
            <AlertDialogTitle>Remove this endpoint?</AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              <span className="font-mono text-foreground">{pendingRemove?.id}</span> stops being
              quotable: an agent asking its price is refused, and one holding an old quote cannot
              spend it. Payments already made are untouched — they are in your ledger and your
              settlements, and stay there.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel />
            <AlertDialogAction
              onClick={() => {
                if (pendingRemove !== null)
                  void remove.mutateAsync(pendingRemove.id).catch(() => {});
                setPendingRemove(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

export default withQuery(X402Resources);
