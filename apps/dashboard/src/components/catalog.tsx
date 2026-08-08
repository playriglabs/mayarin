/**
 * Catalog CRUD — a React island over fixture data.
 *
 * There is no catalog endpoint yet (RFC #10), so create, edit and archive act
 * on local state and are lost on reload. That is deliberate for a UI slice: the
 * shapes in `lib/fixtures` match the DTO the commerce layer is expected to
 * return, so wiring a real endpoint later replaces the data source and leaves
 * this component alone.
 *
 * Both dialogs come from the primitives, which own their own motion — this file
 * no longer hand-rolls a backdrop, a popup or an `AnimatePresence`. It mounts
 * `MotionProvider` because it animates but does not query, so it must not pull
 * React Query into its bundle just to reach a provider.
 */

import { formatMoneyLocale } from "@mayarin/shared/locale";
import { money } from "@mayarin/shared/money";
import { PackageIcon, PencilSimpleIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import { useState } from "react";
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
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  type SelectOption,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, isoAttr } from "@/lib/date";
import { PRODUCTS, type Product, type ProductStatus } from "@/lib/fixtures";
import { ICON_CARD, ICON_NAV } from "@/lib/icons";
import { MotionProvider } from "@/lib/motion";

const STATUS_VARIANT: Readonly<Record<ProductStatus, "success" | "warning" | "default">> = {
  active: "success",
  draft: "warning",
  archived: "default",
};

const STATUS_LABEL: Readonly<Record<ProductStatus, string>> = {
  active: "Active",
  draft: "Draft",
  archived: "Archived",
};

const STATUSES: readonly ProductStatus[] = ["active", "draft", "archived"];

const STATUS_OPTIONS: readonly SelectOption[] = STATUSES.map((s) => ({
  value: s,
  label: STATUS_LABEL[s],
}));

/** Editing an existing product, or creating one. */
type Editing = { readonly mode: "create" } | { readonly mode: "edit"; readonly product: Product };

interface Draft {
  readonly name: string;
  readonly sku: string;
  /** Whole rupiah as typed. Parsed to minor units only on save. */
  readonly price: string;
  readonly status: ProductStatus;
}

const EMPTY_DRAFT: Draft = { name: "", sku: "", price: "", status: "draft" };

function draftOf(editing: Editing): Draft {
  if (editing.mode === "create") return EMPTY_DRAFT;
  const { product } = editing;
  return {
    name: product.name,
    sku: product.sku,
    // IDR carries two minor digits; the field takes whole rupiah.
    price: (product.price / 100n).toString(),
    status: product.status,
  };
}

/** Whole rupiah string to minor units. Digits only — no float ever appears. */
function toMinorUnits(price: string): bigint | undefined {
  const digits = price.replace(/[^\d]/g, "");
  if (digits === "") return undefined;
  return BigInt(digits) * 100n;
}

export default function Catalog() {
  const [products, setProducts] = useState<readonly Product[]>(PRODUCTS);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [notice, setNotice] = useState<string>("");
  const [pendingArchive, setPendingArchive] = useState<Product | null>(null);

  const priceMinor = toMinorUnits(draft.price);
  const canSave = draft.name.trim() !== "" && draft.sku.trim() !== "" && priceMinor !== undefined;

  function open(next: Editing) {
    setEditing(next);
    setDraft(draftOf(next));
  }

  function close() {
    setEditing(null);
  }

  function save() {
    if (editing === null || priceMinor === undefined) return;
    const now = new Date().toISOString();

    if (editing.mode === "create") {
      const created: Product = {
        id: `prod_${(products.length + 1).toString().padStart(2, "0")}`,
        name: draft.name.trim(),
        sku: draft.sku.trim(),
        price: priceMinor,
        currency: "IDR",
        status: draft.status,
        updatedAt: now,
      };
      setProducts([created, ...products]);
      setNotice(`${created.name} created.`);
    } else {
      const id = editing.product.id;
      setProducts(
        products.map((p) =>
          p.id === id
            ? {
                ...p,
                name: draft.name.trim(),
                sku: draft.sku.trim(),
                price: priceMinor,
                status: draft.status,
                updatedAt: now,
              }
            : p,
        ),
      );
      setNotice(`${draft.name.trim()} updated.`);
    }
    close();
  }

  /**
   * Archiving hides a product from the storefront, so it asks first. The
   * pending product is held in state rather than archived optimistically —
   * nothing changes until the dialog is confirmed.
   */
  function archive(product: Product) {
    setProducts(
      products.map((p) =>
        p.id === product.id ? { ...p, status: "archived", updatedAt: new Date().toISOString() } : p,
      ),
    );
    setNotice(`${product.name} archived.`);
  }

  return (
    <MotionProvider>
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-xs text-subtle-foreground">
            {products.length} product{products.length === 1 ? "" : "s"}
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

        {products.length === 0 ? (
          <Empty>
            <EmptyMedia>
              <PackageIcon size={ICON_CARD} aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No products yet.</EmptyTitle>
          </Empty>
        ) : (
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
              {products.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{p.sku}</TableCell>
                  <TableCell className="text-right">
                    {formatMoneyLocale(money(p.price, p.currency))}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[p.status]}>{STATUS_LABEL[p.status]}</Badge>
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
                        disabled={p.status === "archived"}
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
        )}

        <Dialog open={editing !== null} onOpenChange={(next) => !next && close()}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing?.mode === "edit" ? "Edit product" : "New product"}</DialogTitle>
              <DialogDescription>
                Prices are set in the merchant's pricing currency.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3">
              <Field>
                <FieldLabel htmlFor="product-name">Name</FieldLabel>
                <Input
                  id="product-name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="product-sku">SKU</FieldLabel>
                <Input
                  id="product-sku"
                  value={draft.sku}
                  onChange={(e) => setDraft({ ...draft, sku: e.target.value })}
                  className="font-mono text-xs"
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="product-price">Price</FieldLabel>
                <InputGroup>
                  {/* The currency is meaning, not decoration, so it is not
                      hidden from a screen reader. */}
                  <InputGroupAddon aria-hidden={false}>Rp</InputGroupAddon>
                  <InputGroupInput
                    id="product-price"
                    inputMode="numeric"
                    value={draft.price}
                    onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                    aria-describedby="product-price-hint"
                    placeholder="25000"
                  />
                </InputGroup>
                <FieldDescription id="product-price-hint">
                  Whole rupiah. Digits only.
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor="product-status">Status</FieldLabel>
                <Select
                  items={STATUS_OPTIONS}
                  value={draft.status}
                  onValueChange={(next) => setDraft({ ...draft, status: next as ProductStatus })}
                >
                  <SelectTrigger id="product-status">
                    <SelectValue placeholder="Select a status" />
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

            <DialogFooter>
              <DialogClose render={<Button variant="secondary">Cancel</Button>} />
              <Button onClick={save} disabled={!canSave}>
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
                <strong className="font-medium text-foreground">{pendingArchive?.name}</strong>{" "}
                stops appearing in the catalog and cannot be added to new carts. Payments already
                taken for it are not affected.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel />
              <AlertDialogAction
                onClick={() => {
                  if (pendingArchive !== null) archive(pendingArchive);
                  setPendingArchive(null);
                }}
              >
                Archive
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>
    </MotionProvider>
  );
}
