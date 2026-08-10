/**
 * Customers — a React island over the real `/customers` endpoint.
 *
 * The merchant-managed directory. A customer is a commerce record the merchant
 * keeps, like a product — never where money lands, which is why this is
 * `catalog:manage` and not `settings:manage`. A customer links to payments
 * through `metadata.customerId`, stamped at intent creation; the detail page
 * reads that link back.
 *
 * Email and notes are optional and clearable: `null` clears a field, an absent
 * one leaves it alone — the same rule as a product's description.
 */

import { AddressBookIcon, PencilSimpleIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useDeferredValue, useState } from "react";
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
import { Button } from "@/components/ui/button";
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
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
import { Textarea } from "@/components/ui/textarea";
import {
  useCreateCustomer,
  useCustomers,
  useDeleteCustomer,
  useUpdateCustomer,
} from "@/hooks/customers";
import { ApiError } from "@/lib/api/client";
import { formatDateTime, isoAttr } from "@/lib/date";
import { ICON_CARD, ICON_NAV } from "@/lib/icons";
import { withQuery } from "@/lib/with-query";
import type { CustomerDto } from "@/types/customers";

/** Editing an existing customer, or creating one. */
type Editing =
  | { readonly mode: "create" }
  | { readonly mode: "edit"; readonly customer: CustomerDto };

interface Draft {
  readonly name: string;
  readonly email: string;
  readonly notes: string;
}

const EMPTY_DRAFT: Draft = { name: "", email: "", notes: "" };

const SORT_OPTIONS: readonly SelectOption[] = [
  { value: "-created", label: "Newest first" },
  { value: "created", label: "Oldest first" },
];

function draftOf(editing: Editing): Draft {
  if (editing.mode === "create") return EMPTY_DRAFT;
  const { customer } = editing;
  return {
    name: customer.name,
    email: customer.email ?? "",
    notes: customer.notes ?? "",
  };
}

function reasonOf(error: unknown): string {
  return error instanceof ApiError ? error.message : "Failed to load customers";
}

function Customers() {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"created" | "-created">("-created");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const customers = useCustomers({
    limit: 200,
    ...(deferredQuery === "" ? {} : { q: deferredQuery }),
    sort,
    ...(from === "" ? {} : { from }),
    ...(to === "" ? {} : { to }),
  });
  const create = useCreateCustomer();
  const update = useUpdateCustomer();
  const remove = useDeleteCustomer();

  const [editing, setEditing] = useState<Editing | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [notice, setNotice] = useState<string>("");
  const [failure, setFailure] = useState<string>("");
  const [pendingDelete, setPendingDelete] = useState<CustomerDto | null>(null);

  const canSave = draft.name.trim() !== "";
  const saving = create.isPending || update.isPending;

  function open(next: Editing) {
    setFailure("");
    setEditing(next);
    setDraft(draftOf(next));
  }

  async function save() {
    if (editing === null || !canSave) return;
    const name = draft.name.trim();
    const email = draft.email.trim();
    const notes = draft.notes.trim();

    try {
      if (editing.mode === "create") {
        await create.mutateAsync({
          name,
          ...(email === "" ? {} : { email }),
          ...(notes === "" ? {} : { notes }),
        });
        setNotice(`${name} added.`);
      } else {
        await update.mutateAsync({
          id: editing.customer.id,
          patch: {
            name,
            // `null` clears, an absent field leaves it alone — so emptying the
            // field actually empties it rather than reverting on refetch.
            email: email === "" ? null : email,
            notes: notes === "" ? null : notes,
          },
        });
        setNotice(`${name} updated.`);
      }
      setEditing(null);
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Could not save the customer");
    }
  }

  async function del(customer: CustomerDto) {
    try {
      await remove.mutateAsync(customer.id);
      setNotice(`${customer.name} deleted.`);
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Could not delete the customer");
    }
  }

  const rows = customers.data?.customers ?? [];

  return (
    <section className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
        <Field>
          <FieldLabel htmlFor="customer-search">Search</FieldLabel>
          <Input
            id="customer-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, email, or customer id"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="customer-sort">Sort</FieldLabel>
          <Select
            items={SORT_OPTIONS}
            value={sort}
            onValueChange={(value) => setSort(value as typeof sort)}
          >
            <SelectTrigger id="customer-sort">
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
      <div className="grid max-w-sm grid-cols-2 gap-3">
        <DateRangeFilter from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-xs text-subtle-foreground">
          {rows.length} customer{rows.length === 1 ? "" : "s"}
        </p>
        <Button onClick={() => open({ mode: "create" })}>
          <PlusIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
          New customer
        </Button>
      </div>

      <p aria-live="polite" className="sr-only">
        {notice}
      </p>

      {failure !== "" && editing === null && <Alert variant="destructive">{failure}</Alert>}

      {match(customers)
        .with({ isPending: true }, () => <TableSkeleton rows={7} />)
        .with({ isError: true }, ({ error }) => (
          <QueryError
            message={reasonOf(error)}
            retry={() => void customers.refetch()}
            retrying={customers.isFetching}
          />
        ))
        .otherwise(() =>
          rows.length === 0 ? (
            <Empty>
              <EmptyMedia>
                <AddressBookIcon size={ICON_CARD} aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No customers yet.</EmptyTitle>
              <EmptyDescription>Save customer details to recognize repeat buyers.</EmptyDescription>
              <EmptyAction>
                <Button onClick={() => open({ mode: "create" })}>
                  <PlusIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                  Add your first customer
                </Button>
              </EmptyAction>
            </Empty>
          ) : (
            <Table>
              <TableCaption>Customers in this directory</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((customer) => (
                  <TableRow key={customer.id}>
                    <TableCell>
                      <a
                        href={`/customers/${encodeURIComponent(customer.id)}`}
                        className="text-foreground underline decoration-input underline-offset-2 hover:decoration-foreground"
                      >
                        {customer.name}
                      </a>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {customer.email ?? <span className="text-xs text-subtle-foreground">—</span>}
                    </TableCell>
                    <TableCell className="max-w-[16rem] truncate text-sm text-muted-foreground">
                      {customer.notes ?? <span className="text-xs text-subtle-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <time dateTime={isoAttr(customer.updatedAt)}>
                        {formatDateTime(customer.updatedAt)}
                      </time>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => open({ mode: "edit", customer })}
                          aria-label={`Edit ${customer.name}`}
                        >
                          <PencilSimpleIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setPendingDelete(customer)}
                          aria-label={`Delete ${customer.name}`}
                        >
                          <TrashIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                        </Button>
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ),
        )}

      <Dialog open={editing !== null} onOpenChange={(next) => !next && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.mode === "edit" ? "Edit customer" : "New customer"}</DialogTitle>
            <DialogDescription>
              A walk-in customer needs only a name. Email and notes are optional.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            {failure !== "" && <Alert variant="destructive">{failure}</Alert>}

            <Field>
              <FieldLabel htmlFor="customer-name">Name</FieldLabel>
              <Input
                id="customer-name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="customer-email">Email</FieldLabel>
              <Input
                id="customer-email"
                type="email"
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="customer-notes">Notes</FieldLabel>
              <Textarea
                id="customer-notes"
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              />
            </Field>
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="secondary">Cancel</Button>} />
            <Button onClick={save} disabled={!canSave || saving}>
              {editing?.mode === "edit" ? "Save changes" : "Add customer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => !next && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this customer?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="font-medium text-foreground">{pendingDelete?.name}</strong> is
              removed from the directory. Orders already taken for them are not affected — a deleted
              customer leaves their orders behind.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel />
            <AlertDialogAction
              onClick={() => {
                if (pendingDelete !== null) void del(pendingDelete);
                setPendingDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

export default withQuery(Customers);
