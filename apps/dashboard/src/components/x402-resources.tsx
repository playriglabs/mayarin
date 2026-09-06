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

import { GlobeIcon, PlusIcon } from "@phosphor-icons/react";
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
import { Field, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
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
import { withQuery } from "@/lib/with-query";

function reasonOf(error: unknown): string {
  return error instanceof ApiError ? error.message : "Failed to load x402 resources";
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
      await create.mutateAsync({
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
    } catch (error) {
      setFailure(reasonOf(error));
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-xs text-subtle-foreground">
          {rows.length} resource{rows.length === 1 ? "" : "s"}
        </p>
        <Button onClick={open} disabled={offered.length === 0}>
          <PlusIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
          New resource
        </Button>
      </div>

      {rails.isSuccess && offered.length === 0 && (
        <Alert>
          No rail can be offered yet: an x402 resource is paid to your own address, and none is
          verified on a supported chain. Link and verify a wallet under Wallets first.
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
                  Register your first resource
                </Button>
              </EmptyAction>
            </Empty>
          ) : (
            <Table>
              <TableCaption>x402 resources for this merchant</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Resource</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Rails</TableHead>
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
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ),
        )}

      <Dialog open={creating} onOpenChange={(next) => !next && setCreating(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New x402 resource</DialogTitle>
            <DialogDescription>
              One endpoint, one price. Agents pay per request and are paid to your own verified
              address — you never type one here.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            {failure !== "" && <Alert variant="destructive">{failure}</Alert>}

            <Field>
              <FieldLabel htmlFor="x402-id">Resource id</FieldLabel>
              <Input
                id="x402-id"
                value={id}
                onChange={(e) => {
                  setId(e.target.value);
                  setFailure("");
                }}
                placeholder="fx-quote"
              />
            </Field>

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
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="x402-description">Description</FieldLabel>
              <Input
                id="x402-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="One oracle-guarded FX quote"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="x402-price">Price, in USD</FieldLabel>
              <Input
                id="x402-price"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setFailure("");
                }}
                inputMode="decimal"
                placeholder="0.02"
              />
            </Field>

            <FieldSet>
              <FieldLegend className="mb-3">Paid on</FieldLegend>
              {offered.map((rail) => {
                const inputId = `x402-rail-${rail.chain}`;
                return (
                  <div key={rail.chain} className="flex items-start gap-2">
                    <Checkbox
                      id={inputId}
                      checked={chains.has(rail.chain)}
                      onCheckedChange={() => toggleChain(rail.chain)}
                      disabled={create.isPending}
                    />
                    <Label htmlFor={inputId} className="cursor-pointer text-sm text-foreground">
                      <ChainLabel chain={rail.chain} /> · {rail.asset}
                      <span className="block font-mono text-xs text-subtle-foreground">
                        {rail.payTo}
                      </span>
                    </Label>
                  </div>
                );
              })}
            </FieldSet>
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="secondary">Cancel</Button>} />
            <Button onClick={() => void save()} disabled={!canCreate || create.isPending}>
              Register resource
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export default withQuery(X402Resources);
