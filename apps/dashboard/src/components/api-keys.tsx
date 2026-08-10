/**
 * API keys — a React island over the real `/api-keys` endpoint.
 *
 * A merchant mints bearer tokens for a POS or an integration that cannot hold a
 * session cookie. Each key grants a subset of the merchant's own permissions,
 * chosen here with checkboxes. The secret is shown exactly once, on creation —
 * after that only its prefix is visible, enough to tell two keys apart.
 */

import { CheckIcon, CopyIcon, KeyIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { match } from "ts-pattern";
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
import { Field, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import type { ApiKeyDto } from "@/types/api-keys";
import { PERMISSION_LABELS, PERMISSION_LIST, type Permission } from "@/types/user";

function reasonOf(error: unknown): string {
  return error instanceof ApiError ? error.message : "Failed to load API keys";
}

function ApiKeys() {
  const keys = useApiKeys();
  const create = useCreateApiKey();
  const deactivate = useDeactivateApiKey();

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  // A key must grant at least one permission; default to the read surface.
  const [perms, setPerms] = useState<Set<Permission>>(new Set(["payments:read"]));
  const [failure, setFailure] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingRevoke, setPendingRevoke] = useState<ApiKeyDto | null>(null);
  const [minted, setMinted] = useState<{ readonly name: string; readonly secret: string } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);

  const canCreate = name.trim() !== "" && perms.size > 0;

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
        permissions: [...perms],
      });
      setMinted({ name: result.apiKey.name, secret: result.secret });
      setNotice(`${name.trim()} created.`);
      setName("");
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
        .with({ isPending: true }, () => <TableSkeleton rows={3} />)
        .with({ isError: true }, ({ error }) => (
          <Alert variant="destructive">{reasonOf(error)}</Alert>
        ))
        .otherwise(() =>
          rows.length === 0 ? (
            <Empty>
              <EmptyMedia>
                <KeyIcon size={ICON_CARD} aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No API keys yet.</EmptyTitle>
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
                      <span className="flex flex-wrap gap-1">
                        {key.permissions.map((p) => (
                          <Badge key={p} variant="default">
                            {PERMISSION_LABELS[p]}
                          </Badge>
                        ))}
                      </span>
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
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this API key?</AlertDialogTitle>
            <AlertDialogDescription>
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
