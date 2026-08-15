/**
 * API keys — a React island over the real `/api-keys` endpoint.
 *
 * A merchant mints bearer tokens for a POS or an integration that cannot hold a
 * session cookie. Each key grants a subset of the merchant's own permissions,
 * chosen here with checkboxes. The secret is shown exactly once, on creation —
 * after that only its prefix is visible, enough to tell two keys apart.
 */

import { CheckIcon, CopyIcon, KeyIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useDeferredValue, useState } from "react";
import { match } from "ts-pattern";
import { PermissionBadges } from "@/components/permission-badges";
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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Field, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QueryError } from "@/components/ui/query-error";
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
import { useApiKeys, useCreateApiKey, useDeactivateApiKey } from "@/hooks/api-keys";
import { ApiError } from "@/lib/api/client";
import { formatDateTime, isoAttr } from "@/lib/date";
import { ICON_CARD, ICON_NAV } from "@/lib/icons";
import { withQuery } from "@/lib/with-query";
import type { ApiKeyDto, ApiKeyKind } from "@/types/api-keys";
import { PERMISSION_LABELS, PERMISSION_LIST, type Permission } from "@/types/user";

const STATUS_OPTIONS: readonly SelectOption[] = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

const SORT_OPTIONS: readonly SelectOption[] = [
  { value: "-created", label: "Newest first" },
  { value: "created", label: "Oldest first" },
];

const KIND_OPTIONS: readonly SelectOption[] = [
  { value: "secret", label: "Secret — server-side" },
  { value: "publishable", label: "Publishable — browser-safe" },
];

function reasonOf(error: unknown): string {
  return error instanceof ApiError ? error.message : "Failed to load API keys";
}

function ApiKeys() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState<"created" | "-created">("-created");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const keys = useApiKeys({
    ...(deferredQuery === "" ? {} : { q: deferredQuery }),
    ...(status === "all" ? {} : { status: status as "active" | "inactive" }),
    sort,
    ...(from === "" ? {} : { from }),
    ...(to === "" ? {} : { to }),
  });
  const create = useCreateApiKey();
  const deactivate = useDeactivateApiKey();

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ApiKeyKind>("secret");
  // A secret key must grant at least one permission; default to the read
  // surface. A publishable key carries none — its surface is fixed (#113).
  const [perms, setPerms] = useState<Set<Permission>>(new Set(["payments:read"]));
  const [failure, setFailure] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingRevoke, setPendingRevoke] = useState<ApiKeyDto | null>(null);
  const [minted, setMinted] = useState<{ readonly name: string; readonly secret: string } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);

  const canCreate = name.trim() !== "" && (kind === "publishable" || perms.size > 0);

  function togglePerm(p: Permission) {
    setFailure("");
    setPerms((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  async function copySecret() {
    if (minted === null) return;
    try {
      await navigator.clipboard.writeText(minted.secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setFailure("Could not reach the clipboard — copy the secret from the field above.");
    }
  }

  async function save() {
    if (!canCreate) return;
    try {
      const result = await create.mutateAsync({
        name: name.trim(),
        kind,
        permissions: kind === "publishable" ? [] : [...perms],
      });
      setMinted({ name: result.apiKey.name, secret: result.secret });
      setNotice(`${name.trim()} created.`);
      setName("");
      setKind("secret");
      setPerms(new Set(["payments:read"]));
      setCreating(false);
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Could not create the key");
    }
  }

  async function revoke(key: ApiKeyDto) {
    try {
      await deactivate.mutateAsync(key.id);
      setNotice(`${key.name} revoked.`);
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Could not revoke the key");
    }
  }

  const rows = keys.data?.apiKeys ?? [];

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-56 flex-1">
          <Field>
            <FieldLabel htmlFor="key-search">Search</FieldLabel>
            <Input
              id="key-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name, prefix, or key id"
            />
          </Field>
        </div>
        <div className="w-full sm:w-44">
          <Field>
            <FieldLabel htmlFor="key-status">Status</FieldLabel>
            <Select items={STATUS_OPTIONS} value={status} onValueChange={setStatus}>
              <SelectTrigger id="key-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <div className="grid w-full grid-cols-2 gap-3 sm:w-auto">
          <DateRangeFilter from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
        </div>
        <div className="w-full sm:w-44">
          <Field>
            <FieldLabel htmlFor="key-sort">Sort</FieldLabel>
            <Select
              items={SORT_OPTIONS}
              value={sort}
              onValueChange={(value) => setSort(value as typeof sort)}
            >
              <SelectTrigger id="key-sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-xs text-subtle-foreground">
          {rows.length} key{rows.length === 1 ? "" : "s"}
        </p>
        <Button
          onClick={() => {
            setFailure("");
            setCreating(true);
          }}
        >
          <PlusIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
          New API key
        </Button>
      </div>

      <p aria-live="polite" className="sr-only">
        {notice}
      </p>

      {failure !== "" && !creating && <Alert variant="destructive">{failure}</Alert>}

      {match(keys)
        .with({ isPending: true }, () => <TableSkeleton rows={7} />)
        .with({ isError: true }, ({ error }) => (
          <QueryError
            message={reasonOf(error)}
            retry={() => void keys.refetch()}
            retrying={keys.isFetching}
          />
        ))
        .otherwise(() =>
          rows.length === 0 ? (
            <Empty>
              <EmptyMedia>
                <KeyIcon size={ICON_CARD} aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No API keys yet.</EmptyTitle>
              <EmptyDescription>
                Create a scoped key to connect your first integration.
              </EmptyDescription>
              <EmptyAction>
                <Button
                  onClick={() => {
                    setFailure("");
                    setCreating(true);
                  }}
                >
                  <PlusIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                  Mint your first API key
                </Button>
              </EmptyAction>
            </Empty>
          ) : (
            <Table>
              <TableCaption>API keys for this merchant</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Prefix</TableHead>
                  <TableHead>Permissions</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell>{key.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {key.prefix}…
                    </TableCell>
                    <TableCell>
                      {key.kind === "publishable" ? (
                        <Badge>Publishable</Badge>
                      ) : (
                        <PermissionBadges permissions={key.permissions} />
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {key.lastUsedAt === null ? (
                        <span className="text-xs text-subtle-foreground">Never</span>
                      ) : (
                        <time dateTime={isoAttr(key.lastUsedAt)}>
                          {formatDateTime(key.lastUsedAt)}
                        </time>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={key.active ? "success" : "default"}>
                        {key.active ? "Active" : "Revoked"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setPendingRevoke(key)}
                        disabled={!key.active}
                        aria-label={`Revoke ${key.name}`}
                      >
                        <TrashIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                      </Button>
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
            <DialogTitle>New API key</DialogTitle>
            <DialogDescription>
              A key grants a subset of your own permissions. The secret is shown once after you
              create it — store it somewhere safe, you will not see it again.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            {failure !== "" && <Alert variant="destructive">{failure}</Alert>}

            <Field>
              <FieldLabel htmlFor="api-key-name">Name</FieldLabel>
              <Input
                id="api-key-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setFailure("");
                }}
                placeholder="POS register 3"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="api-key-kind">Kind</FieldLabel>
              <Select
                items={KIND_OPTIONS}
                value={kind}
                onValueChange={(value) => {
                  setKind(value as ApiKeyKind);
                  setFailure("");
                }}
              >
                <SelectTrigger id="api-key-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KIND_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {kind === "publishable" ? (
              <p className="text-sm text-muted-foreground">
                A publishable key (<code className="font-mono text-xs">pk_…</code>) is safe to ship
                in a browser bundle. It reads your catalog and checks out carts for your own
                merchant — nothing else, and no permissions to choose.
              </p>
            ) : (
              <FieldSet>
                <FieldLegend className="mb-3">Permissions</FieldLegend>
                {PERMISSION_LIST.map((p) => {
                  const id = `key-perm-${p.replace(":", "-")}`;
                  return (
                    <div key={p} className="flex items-center gap-2">
                      <Checkbox
                        id={id}
                        checked={perms.has(p)}
                        onCheckedChange={() => togglePerm(p)}
                        disabled={create.isPending}
                      />
                      <Label htmlFor={id} className="cursor-pointer text-sm text-foreground">
                        {PERMISSION_LABELS[p]}
                      </Label>
                    </div>
                  );
                })}
              </FieldSet>
            )}
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="secondary">Cancel</Button>} />
            <Button onClick={save} disabled={!canCreate || create.isPending}>
              Create key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* The one-time secret. Shown after creation, never re-openable. */}
      <Dialog
        open={minted !== null}
        onOpenChange={(next) => {
          if (!next) {
            setMinted(null);
            setCopied(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save your API key secret</DialogTitle>
            <DialogDescription className="mt-2">
              This is the only time{" "}
              <strong className="font-medium text-foreground">{minted?.name}</strong> will be shown.
              Store it somewhere safe — Mayarin cannot recover it, and a lost secret means a new
              key.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <code className="block break-all rounded bg-muted p-3 font-mono text-xs text-foreground">
              {minted?.secret}
            </code>
            <Button onClick={copySecret} variant="secondary">
              {copied ? (
                <CheckIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
              ) : (
                <CopyIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
              )}
              {copied ? "Copied" : "Copy secret"}
            </Button>
          </div>

          <DialogFooter>
            <Button
              onClick={() => {
                setMinted(null);
                setCopied(false);
              }}
            >
              I&apos;ve saved it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingRevoke !== null}
        onOpenChange={(next) => !next && setPendingRevoke(null)}
      >
        <AlertDialogContent className="max-w-md gap-6 p-6">
          <AlertDialogHeader className="gap-2">
            <AlertDialogTitle>Revoke this API key?</AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              <strong className="font-medium text-foreground">{pendingRevoke?.name}</strong> stops
              working immediately. Anything using it will get a 401 on its next request. A revoked
              key cannot be reactivated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel />
            <AlertDialogAction
              onClick={() => {
                if (pendingRevoke !== null) void revoke(pendingRevoke);
                setPendingRevoke(null);
              }}
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

export default withQuery(ApiKeys);
