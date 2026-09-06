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
  CheckIcon,
  CopyIcon,
  GlobeIcon,
  PlusIcon,
  TerminalWindowIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { match } from "ts-pattern";
import { ChainLabel } from "@/components/chain-logo";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { useCreateX402Resource, useX402Rails, useX402Resources } from "@/hooks/x402";
import { ApiError } from "@/lib/api/client";
import { ICON_CARD, ICON_NAV } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { withQuery } from "@/lib/with-query";
import type { X402ResourceDto } from "@/types/x402";

function reasonOf(error: unknown): string {
  return error instanceof ApiError ? error.message : "Failed to load agent endpoints";
}

/**
 * The gate, as the merchant's own server has to implement it.
 *
 * Written against `fetch` and the two header names from the specification, so it
 * ports to any framework by changing how the request and response are spelled.
 * The ids and the base URL are the real ones for this resource: a guide a
 * developer has to fill in by hand is a guide they get wrong.
 */
function snippetFor(resource: X402ResourceDto, baseUrl: string): string {
  const api = baseUrl === "" ? "https://your-mayarin-api" : baseUrl.replace(/\/$/, "");
  const id = resource.id;
  return `const MAYARIN = ${JSON.stringify(api)};
const RESOURCE = ${JSON.stringify(id)};

export async function handle(request) {
  const signature = request.headers.get("PAYMENT-SIGNATURE");

  // 1. Nothing paid yet: answer 402 with the price Mayarin quotes.
  if (!signature) {
    const required = await fetch(
      \`\${MAYARIN}/x402/resources/\${RESOURCE}/payment-required\`,
    ).then((r) => r.json());

    return new Response(null, {
      status: 402,
      headers: { "PAYMENT-REQUIRED": btoa(JSON.stringify(required)) },
    });
  }

  // 2. Verify, then settle. Never serve first.
  const paymentPayload = JSON.parse(atob(signature));
  const body = { x402Version: 2, paymentPayload, paymentRequirements: paymentPayload.accepted };
  const call = (step) =>
    fetch(\`\${MAYARIN}/x402/resources/\${RESOURCE}/\${step}\`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json());

  const verified = await call("verify");
  if (!verified.isValid) return new Response(null, { status: 402 });

  const settled = await call("settle");
  if (!settled.success) return new Response(null, { status: 402 });

  // 3. Paid. Serve it, and say which transaction paid for it.
  return new Response(yourContent, {
    headers: { "PAYMENT-RESPONSE": btoa(JSON.stringify(settled)) },
  });
}`;
}

function X402Resources() {
  const resources = useX402Resources();
  const rails = useX402Rails();
  const create = useCreateX402Resource();

  const [creating, setCreating] = useState(false);
  const [id, setId] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [chains, setChains] = useState<Set<string>>(new Set());
  const [failure, setFailure] = useState("");
  const [guide, setGuide] = useState<X402ResourceDto | null>(null);
  const [copied, setCopied] = useState(false);

  const offered = rails.data?.rails ?? [];
  const facilitator = resources.data?.facilitatorBaseUrl ?? "";
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
                  <TableHead className="text-right">Setup</TableHead>
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
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setCopied(false);
                          setGuide(resource);
                        }}
                        aria-label={`How to gate ${resource.id}`}
                      >
                        <TerminalWindowIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                      </Button>
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
      <Dialog
        open={guide !== null}
        onOpenChange={(next) => {
          if (!next) {
            setGuide(null);
            setCopied(false);
          }
        }}
      >
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

          <div className="relative">
            <pre className="overflow-x-auto border border-border bg-muted p-3 font-mono text-foreground text-xs">
              <code>{guide === null ? "" : snippetFor(guide, facilitator)}</code>
            </pre>
            <Button
              variant="secondary"
              size="sm"
              className="absolute top-2 right-2"
              onClick={() => {
                if (guide === null) return;
                void navigator.clipboard.writeText(snippetFor(guide, facilitator));
                setCopied(true);
              }}
            >
              {copied ? (
                <CheckIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
              ) : (
                <CopyIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>

          <p className="text-subtle-foreground text-xs">
            No key and no chain code run on your server: it never holds the payer’s signature for
            longer than the request, and Mayarin does the verifying, broadcasting and bookkeeping.
            The URL you registered must be exactly the one an agent calls.
          </p>

          <DialogFooter>
            <Button onClick={() => setGuide(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export default withQuery(X402Resources);
