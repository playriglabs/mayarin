/**
 * Catalog — a React island over the real `/catalog/products` endpoint (#15).
 *
 * A product carries one amount per currency it is priced in, entered by the
 * merchant. Nothing is converted at read time: converting would make a
 * displayed price move with an FX feed between the moment a buyer reads it and
 * the moment they pay. The form exposes that full list: adding, updating and
 * removing a currency are distinct, visible actions rather than an implicit
 * merge hidden behind a single price field.
 *
 * Amounts are typed and sent as decimal strings and parsed server-side by the
 * schema that owns minor units. No `bigint` arithmetic happens here, so there
 * is no second implementation to drift.
 *
 * The catalog is optional by construction: a merchant who never writes a
 * product row can still take every payment, through an open or fixed link.
 */

import { PackageIcon, PencilSimpleIcon, PlusIcon, TrashIcon, XIcon } from "@phosphor-icons/react";
import { motion } from "motion/react";
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
import { CurrencyInput } from "@/components/ui/currency-input";
import { CursorPagination } from "@/components/ui/cursor-pagination";
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
import { useCreateProduct, useProducts, useUpdateProduct } from "@/hooks/catalog";
import { useCursorPagination } from "@/hooks/cursor-pagination";
import { ApiError } from "@/lib/api/client";
import { formatDateTime, isoAttr } from "@/lib/date";
import { ICON_CARD, ICON_NAV } from "@/lib/icons";
import { drawerVariants } from "@/lib/motion";
import { PAGE_SIZE } from "@/lib/pagination";
import { currencyLabel, isValidAmount, PRICING_CURRENCIES } from "@/lib/pricing";
import { withQuery } from "@/lib/with-query";
import type { DecimalMoneyRequest, ProductDto } from "@/types/catalog";

const CURRENCY_OPTIONS: readonly SelectOption[] = PRICING_CURRENCIES.map((code) => ({
  value: code,
  label: currencyLabel(code),
}));

/** Editing an existing product, or creating one. */
type Editing =
  | { readonly mode: "create" }
  | { readonly mode: "edit"; readonly product: ProductDto };

/** One metadata row as typed. Assembled into a record only at save. */
interface MetadataPair {
  readonly key: string;
  readonly value: string;
}

interface Draft {
  readonly name: string;
  readonly sku: string;
  readonly description: string;
  /** One explicit merchant-entered amount per currency. */
  readonly prices: readonly DecimalMoneyRequest[];
  readonly pairs: readonly MetadataPair[];
}

const EMPTY_DRAFT: Draft = {
  name: "",
  sku: "",
  description: "",
  prices: [{ amount: "", asset: PRICING_CURRENCIES[0] ?? "IDR" }],
  pairs: [],
};

function draftOf(editing: Editing): Draft {
  if (editing.mode === "create") return EMPTY_DRAFT;
  const { product } = editing;
  // `formatted` is the machine form: ungrouped, dot-separated, round-trips
  // exactly. `display` is for reading and would come back as `50.000,00`.
  return {
    name: product.name,
    sku: product.sku,
    description: product.description ?? "",
    prices: product.prices.map((price) => ({ amount: price.formatted, asset: price.asset })),
    pairs: Object.entries(product.metadata).map(([key, value]) => ({ key, value })),
  };
}

/**
 * The typed rows as the wire record. A row with an empty key is still being
 * typed, not a fact about the product, so it is dropped rather than refused.
 */
function metadataOf(pairs: readonly MetadataPair[]): Record<string, string> {
  return Object.fromEntries(
    pairs
      .filter((pair) => pair.key.trim() !== "")
      .map((pair) => [pair.key.trim(), pair.value.trim()]),
  );
}

function reasonOf(error: unknown): string {
  return error instanceof ApiError ? error.message : "Failed to load products";
}

function Catalog() {
  const pagination = useCursorPagination();
  const products = useProducts(PAGE_SIZE, pagination.cursor);
  const create = useCreateProduct();
  const update = useUpdateProduct();

  const [editing, setEditing] = useState<Editing | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [notice, setNotice] = useState<string>("");
  const [failure, setFailure] = useState<string>("");
  const [pendingArchive, setPendingArchive] = useState<ProductDto | null>(null);

  const canSave =
    draft.name.trim() !== "" &&
    draft.sku.trim() !== "" &&
    draft.prices.length > 0 &&
    new Set(draft.prices.map((price) => price.asset)).size === draft.prices.length &&
    draft.prices.every((price) => isValidAmount(price.amount, price.asset));
  const saving = create.isPending || update.isPending;

  function open(next: Editing) {
    setFailure("");
    setEditing(next);
    setDraft(draftOf(next));
  }

  async function save() {
    if (editing === null || !canSave) return;
    const prices = draft.prices.map((price) => ({
      amount: price.amount.trim(),
      asset: price.asset,
    }));
    const description = draft.description.trim();
    const metadata = metadataOf(draft.pairs);

    try {
      if (editing.mode === "create") {
        await create.mutateAsync({
          sku: draft.sku.trim(),
          name: draft.name.trim(),
          prices,
          ...(description === "" ? {} : { description }),
          ...(Object.keys(metadata).length === 0 ? {} : { metadata }),
        });
        setNotice(`${draft.name.trim()} created.`);
      } else {
        await update.mutateAsync({
          id: editing.product.id,
          patch: {
            name: draft.name.trim(),
            // The editor shows the complete price set, so removal is explicit
            // and the API's wholesale replacement semantics are visible.
            prices,
            // `null` clears it, an absent field leaves it alone — so emptying
            // the field actually empties it rather than reverting on refetch.
            description: description === "" ? null : description,
            // Sent even when empty: the API replaces metadata wholesale, and
            // an empty record is how "I removed the last pair" is spelled.
            metadata,
          },
        });
        setNotice(`${draft.name.trim()} updated.`);
      }
      setEditing(null);
    } catch (error) {
      // The dialog stays open on failure: a merchant who mistyped a SKU should
      // not have to retype the whole product to find out which field it was.
      setFailure(error instanceof ApiError ? error.message : "Could not save the product");
    }
  }

  function updatePrice(index: number, patch: Partial<DecimalMoneyRequest>) {
    setDraft({
      ...draft,
      prices: draft.prices.map((price, priceIndex) =>
        priceIndex === index ? { ...price, ...patch } : price,
      ),
    });
  }

  function addPrice() {
    const used = new Set(draft.prices.map((price) => price.asset));
    const asset = PRICING_CURRENCIES.find((currency) => !used.has(currency));
    if (asset === undefined) return;
    setDraft({ ...draft, prices: [...draft.prices, { amount: "", asset }] });
  }

  function removePrice(index: number) {
    if (draft.prices.length === 1) return;
    setDraft({ ...draft, prices: draft.prices.filter((_, priceIndex) => priceIndex !== index) });
  }

  /** Archiving retires a product. Payments already taken for it are untouched. */
  async function archive(product: ProductDto) {
    try {
      await update.mutateAsync({ id: product.id, patch: { active: false } });
      setNotice(`${product.name} archived.`);
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Could not archive the product");
    }
  }

  const rows = products.data?.products ?? [];

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-xs text-subtle-foreground">
          {rows.length} product{rows.length === 1 ? "" : "s"} on this page
        </p>
        <Button onClick={() => open({ mode: "create" })}>
          <PlusIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
          New product
        </Button>
      </div>

      {/* Every mutation is announced once, so the change is not visual-only. */}
      <p aria-live="polite" className="sr-only">
        {notice}
      </p>

      {failure !== "" && editing === null && <Alert variant="destructive">{failure}</Alert>}

      {match(products)
        .with({ isPending: true }, () => <TableSkeleton bigSize rows={PAGE_SIZE} />)
        .with({ isError: true }, ({ error }) => (
          <QueryError
            message={reasonOf(error)}
            retry={() => void products.refetch()}
            retrying={products.isFetching}
          />
        ))
        .otherwise(() =>
          rows.length === 0 ? (
            <Empty>
              <EmptyMedia>
                <PackageIcon size={ICON_CARD} aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No products yet.</EmptyTitle>
              <EmptyDescription>
                Add an item before creating a catalog payment link.
              </EmptyDescription>
              <EmptyAction>
                <Button onClick={() => open({ mode: "create" })}>
                  <PlusIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                  Create your first product
                </Button>
              </EmptyAction>
            </Empty>
          ) : (
            <div className="flex flex-col gap-3">
              <Table>
                <TableCaption>Products in this catalog</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{p.name}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {p.sku}
                      </TableCell>
                      <TableCell className="text-right">
                        {/* Keep prices on one row while space allows, then wrap
                          without letting a long catalog widen the table. */}
                        <span className="flex flex-wrap justify-end gap-x-3 gap-y-1">
                          {p.prices.map((price) => (
                            <span key={price.asset} className="whitespace-nowrap">
                              {price.display}
                            </span>
                          ))}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={p.active ? "success" : "default"}>
                          {p.active ? "Active" : "Archived"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <time dateTime={isoAttr(p.updatedAt)}>{formatDateTime(p.updatedAt)}</time>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => open({ mode: "edit", product: p })}
                            aria-label={`Edit ${p.name}`}
                          >
                            <PencilSimpleIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setPendingArchive(p)}
                            disabled={!p.active}
                            aria-label={`Archive ${p.name}`}
                          >
                            <XIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                          </Button>
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <CursorPagination
                label="Product pages"
                page={pagination.page}
                canPrevious={pagination.canPrevious}
                nextCursor={products.data?.nextCursor}
                busy={products.isFetching}
                onPrevious={pagination.previous}
                onNext={pagination.next}
              />
            </div>
          ),
        )}

      <Dialog open={editing !== null} onOpenChange={(next) => !next && setEditing(null)}>
        <DialogContent
          className="top-0 right-0 bottom-0 left-auto h-svh w-full max-w-xl gap-0 overflow-hidden rounded-r-none rounded-l-lg border-y-0 border-r-0 p-0"
          render={
            <motion.div variants={drawerVariants} initial="initial" animate="animate" exit="exit" />
          }
        >
          <DialogHeader className="shrink-0 border-b border-border px-6 py-5">
            <DialogTitle>{editing?.mode === "edit" ? "Edit product" : "New product"}</DialogTitle>
            <DialogDescription>
              Priced in the currency your customers think in. What you settle in is a separate
              setting.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="flex flex-col gap-3">
              {failure !== "" && <Alert variant="destructive">{failure}</Alert>}

              <Field>
                <FieldLabel htmlFor="product-name">Name</FieldLabel>
                <Input
                  id="product-name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="e.g. Premium coffee"
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="product-sku">SKU</FieldLabel>
                <Input
                  id="product-sku"
                  value={draft.sku}
                  onChange={(e) => setDraft({ ...draft, sku: e.target.value })}
                  placeholder="e.g. COFFEE-001"
                  className="font-mono text-xs"
                  // The SKU is the merchant's own item code and is unique per
                  // merchant, so it identifies the row and cannot be re-pointed.
                  disabled={editing?.mode === "edit"}
                />
              </Field>

              <FieldSet>
                <FieldLegend>Prices</FieldLegend>
                <FieldDescription id="product-prices-hint" className="mt-px mb-3">
                  Add one explicit price for each currency you accept. Removing a currency can make
                  existing catalog payment links in that currency unavailable.
                </FieldDescription>
                <div className="flex flex-col gap-3">
                  {draft.prices.map((price, index) => {
                    const currencyId = `product-currency-${index}`;
                    const priceId = `product-price-${index}`;
                    const usedByAnotherRow = new Set(
                      draft.prices
                        .filter((_, priceIndex) => priceIndex !== index)
                        .map((entry) => entry.asset),
                    );

                    return (
                      <div
                        key={price.asset}
                        className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_2.5rem] items-end gap-2"
                      >
                        <Field>
                          <FieldLabel htmlFor={currencyId}>Currency {index + 1}</FieldLabel>
                          <Select
                            items={CURRENCY_OPTIONS}
                            value={price.asset}
                            onValueChange={(asset) => updatePrice(index, { asset, amount: "" })}
                          >
                            <SelectTrigger id={currencyId}>
                              <SelectValue placeholder="Select a currency" />
                            </SelectTrigger>
                            <SelectContent>
                              {CURRENCY_OPTIONS.map((option) => (
                                <SelectItem
                                  key={option.value}
                                  value={option.value}
                                  disabled={usedByAnotherRow.has(option.value)}
                                >
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field>
                          <FieldLabel htmlFor={priceId}>Amount</FieldLabel>
                          <CurrencyInput
                            id={priceId}
                            asset={price.asset}
                            value={price.amount}
                            onValueChange={(amount) => updatePrice(index, { amount })}
                            aria-describedby="product-prices-hint"
                            placeholder="25.000,00"
                          />
                        </Field>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-10"
                          aria-label={`Remove ${price.asset} price`}
                          disabled={draft.prices.length === 1}
                          onClick={() => removePrice(index)}
                        >
                          <TrashIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
                {draft.prices.length < PRICING_CURRENCIES.length && (
                  <Button
                    type="button"
                    variant="secondary"
                    className="self-start"
                    onClick={addPrice}
                  >
                    <PlusIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                    Add price
                  </Button>
                )}
              </FieldSet>

              <Field>
                <FieldLabel htmlFor="product-description">Description</FieldLabel>
                <Textarea
                  id="product-description"
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  placeholder="Add a short description"
                />
              </Field>

              <Field>
                <FieldLabel>Metadata</FieldLabel>
                {draft.pairs.map((pair, index) => (
                  <div
                    className="flex items-center gap-2"
                    // biome-ignore lint/suspicious/noArrayIndexKey: rows only append and remove, and every input is controlled
                    key={index}
                  >
                    <Input
                      value={pair.key}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          pairs: draft.pairs.map((p, i) =>
                            i === index ? { ...p, key: e.target.value } : p,
                          ),
                        })
                      }
                      placeholder="key"
                      aria-label={`Metadata key ${index + 1}`}
                      className="font-mono text-xs"
                    />
                    <Input
                      value={pair.value}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          pairs: draft.pairs.map((p, i) =>
                            i === index ? { ...p, value: e.target.value } : p,
                          ),
                        })
                      }
                      placeholder="value"
                      aria-label={`Metadata value ${index + 1}`}
                      className="font-mono text-xs"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setDraft({ ...draft, pairs: draft.pairs.filter((_, i) => i !== index) })
                      }
                      aria-label={`Remove metadata pair ${index + 1}`}
                    >
                      <XIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="secondary"
                  className="w-fit"
                  onClick={() =>
                    setDraft({ ...draft, pairs: [...draft.pairs, { key: "", value: "" }] })
                  }
                >
                  <PlusIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                  Add metadata
                </Button>
                <FieldDescription className="mt-2">
                  Key-value pairs stored on the product and returned by the API — an internal
                  category, a warehouse bin, a supplier code. Buyers never see them.
                </FieldDescription>
              </Field>
            </div>
          </div>

          <DialogFooter className="shrink-0 border-t border-border bg-popover px-6 py-4">
            <DialogClose render={<Button variant="secondary">Cancel</Button>} />
            <Button onClick={save} disabled={!canSave || saving}>
              {editing?.mode === "edit" ? "Save changes" : "Create product"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingArchive !== null}
        onOpenChange={(next) => !next && setPendingArchive(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this product?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="font-medium text-foreground">{pendingArchive?.name}</strong> stops
              appearing in the catalog and cannot be added to new carts. Payments already taken for
              it are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel />
            <AlertDialogAction
              onClick={() => {
                if (pendingArchive !== null) void archive(pendingArchive);
                setPendingArchive(null);
              }}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

export default withQuery(Catalog);
