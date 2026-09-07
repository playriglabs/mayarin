/** Merchant invoice creation, sharing, and payment status. */

import {
  ArrowSquareOutIcon,
  CheckIcon,
  CopyIcon,
  FileTextIcon,
  PaperPlaneTiltIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";
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
import { Button, buttonVariants } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
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
  useCreateInvoice,
  useInvoices,
  useIssueInvoice,
  useSendInvoiceEmail,
  useVoidInvoice,
} from "@/hooks/invoices";
import { ApiError } from "@/lib/api/client";
import { formatDate, isoAttr } from "@/lib/date";
import { ICON_CARD, ICON_NAV } from "@/lib/icons";
import { currencyLabel, isValidAmount, PRICING_CURRENCIES } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { withQuery } from "@/lib/with-query";
import type { InvoiceDto, InvoiceStatus } from "@/types/invoices";

const CURRENCY_OPTIONS: readonly SelectOption[] = PRICING_CURRENCIES.map((currency) => ({
  value: currency,
  label: currencyLabel(currency),
}));

const STATUS_LABEL: Readonly<Record<InvoiceStatus, string>> = {
  draft: "Draft",
  issued: "Awaiting payment",
  partially_paid: "Partially paid",
  paid: "Paid",
  overdue: "Overdue",
  void: "Void",
};

const STATUS_TONE: Readonly<
  Record<InvoiceStatus, "default" | "warning" | "success" | "destructive">
> = {
  draft: "default",
  issued: "warning",
  partially_paid: "warning",
  paid: "success",
  overdue: "destructive",
  void: "default",
};

interface LineDraft {
  readonly id: number;
  readonly name: string;
  readonly amount: string;
  readonly quantity: string;
}

interface Draft {
  readonly buyerName: string;
  readonly buyerEmail: string;
  readonly buyerTaxId: string;
  readonly buyerAddress: string;
  readonly currency: string;
  readonly dueDate: string;
  readonly notes: string;
  readonly lines: readonly LineDraft[];
}

const EMPTY_LINE: LineDraft = { id: 1, name: "", amount: "", quantity: "1" };
const EMPTY_DRAFT: Draft = {
  buyerName: "",
  buyerEmail: "",
  buyerTaxId: "",
  buyerAddress: "",
  currency: PRICING_CURRENCIES[0] ?? "IDR",
  dueDate: "",
  notes: "",
  lines: [EMPTY_LINE],
};

function dueTimestamp(date: string): string {
  // Invoice dates are presented in Jakarta by the hosted document. 16:59 UTC
  // is the end of that selected calendar day there, without moving the printed
  // date into tomorrow.
  return `${date}T16:59:59.999Z`;
}

function validQuantity(value: string): boolean {
  const quantity = Number(value);
  return Number.isInteger(quantity) && quantity > 0 && quantity <= 1_000_000;
}

function validEmail(value: string): boolean {
  return value === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function reasonOf(error: unknown): string {
  return error instanceof ApiError ? error.message : "Failed to load invoices";
}

function lineSummary(invoice: InvoiceDto): string {
  const first = invoice.lines[0];
  if (first === undefined) return "—";
  const remaining = invoice.lines.length - 1;
  return remaining === 0 ? first.name : `${first.name} +${remaining}`;
}

function Invoices() {
  const invoices = useInvoices();
  const create = useCreateInvoice();
  const issue = useIssueInvoice();
  const sendEmail = useSendInvoiceEmail();
  const voidInvoice = useVoidInvoice();
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [nextLineId, setNextLineId] = useState(2);
  const [sharing, setSharing] = useState<InvoiceDto | null>(null);
  const [issuing, setIssuing] = useState<InvoiceDto | null>(null);
  const [issueDueDate, setIssueDueDate] = useState("");
  const [pendingVoid, setPendingVoid] = useState<InvoiceDto | null>(null);
  const [copied, setCopied] = useState(false);
  const [emailed, setEmailed] = useState(false);
  const [notice, setNotice] = useState("");
  const [failure, setFailure] = useState("");

  const canCreate =
    draft.buyerName.trim() !== "" &&
    validEmail(draft.buyerEmail.trim()) &&
    draft.dueDate !== "" &&
    draft.lines.length > 0 &&
    draft.lines.every(
      (line) =>
        line.name.trim() !== "" &&
        isValidAmount(line.amount, draft.currency) &&
        validQuantity(line.quantity),
    );

  function resetCreate() {
    setDraft(EMPTY_DRAFT);
    setNextLineId(2);
    setFailure("");
  }

  function updateLine(id: number, patch: Partial<Omit<LineDraft, "id">>) {
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) => (line.id === id ? { ...line, ...patch } : line)),
    }));
  }

  function addLine() {
    const id = nextLineId;
    setNextLineId(id + 1);
    setDraft((current) => ({
      ...current,
      lines: [...current.lines, { id, name: "", amount: "", quantity: "1" }],
    }));
  }

  function removeLine(id: number) {
    setDraft((current) => ({
      ...current,
      lines: current.lines.filter((line) => line.id !== id),
    }));
  }

  async function generateInvoice() {
    if (!canCreate) return;
    setFailure("");
    try {
      const { invoice } = await create.mutateAsync({
        buyer: {
          name: draft.buyerName.trim(),
          ...(draft.buyerEmail.trim() === "" ? {} : { email: draft.buyerEmail.trim() }),
          ...(draft.buyerTaxId.trim() === "" ? {} : { taxId: draft.buyerTaxId.trim() }),
          ...(draft.buyerAddress.trim() === "" ? {} : { address: draft.buyerAddress.trim() }),
        },
        currency: draft.currency,
        lines: draft.lines.map((line) => ({
          name: line.name.trim(),
          unitPrice: { amount: line.amount.trim(), asset: draft.currency },
          quantity: Number(line.quantity),
        })),
        dueAt: dueTimestamp(draft.dueDate),
        ...(draft.notes.trim() === "" ? {} : { notes: draft.notes.trim() }),
      });
      setCreating(false);
      resetCreate();
      setCopied(false);
      setEmailed(false);
      setSharing(invoice);
      setNotice(`${invoice.number ?? "Invoice"} is ready to send.`);
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Could not generate the invoice");
    }
  }

  async function issueDraft() {
    if (issuing === null || issueDueDate === "") return;
    setFailure("");
    try {
      const { invoice } = await issue.mutateAsync({
        id: issuing.id,
        dueAt: dueTimestamp(issueDueDate),
      });
      setIssuing(null);
      setIssueDueDate("");
      setCopied(false);
      setEmailed(false);
      setSharing(invoice);
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Could not issue the invoice");
    }
  }

  async function confirmVoid() {
    if (pendingVoid === null) return;
    setFailure("");
    try {
      await voidInvoice.mutateAsync(pendingVoid.id);
      setNotice(`${pendingVoid.number ?? "Invoice"} was voided.`);
      setPendingVoid(null);
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Could not void the invoice");
    }
  }

  async function copyLink(invoice: InvoiceDto, showCopied = false) {
    try {
      await navigator.clipboard.writeText(invoice.url);
      if (showCopied) setCopied(true);
      setNotice("Client payment link copied.");
    } catch {
      setFailure("Could not reach the clipboard — copy the link from the dialog instead.");
    }
  }

  async function emailInvoice(invoice: InvoiceDto) {
    if (invoice.buyer.email === null) return;
    setFailure("");
    setEmailed(false);
    try {
      await sendEmail.mutateAsync(invoice.id);
      setEmailed(true);
      setNotice(`Invoice emailed to ${invoice.buyer.email}.`);
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Could not email the invoice");
    }
  }

  const rows = invoices.data?.invoices ?? [];

  return (
    <section className="flex flex-col gap-4">
      {notice !== "" && <Alert role="status">{notice}</Alert>}
      {failure !== "" && <Alert variant="destructive">{failure}</Alert>}

      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-xs text-subtle-foreground">
          {rows.length} invoice{rows.length === 1 ? "" : "s"}
        </p>
        <Button
          onClick={() => {
            resetCreate();
            setCreating(true);
          }}
        >
          <PlusIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
          Generate invoice
        </Button>
      </div>

      {match(invoices)
        .with({ isPending: true }, () => <TableSkeleton rows={7} />)
        .with({ isError: true }, ({ error }) => (
          <QueryError
            message={reasonOf(error)}
            retry={() => void invoices.refetch()}
            retrying={invoices.isFetching}
          />
        ))
        .otherwise(() =>
          rows.length === 0 ? (
            <Empty>
              <EmptyMedia>
                <FileTextIcon size={ICON_CARD} aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No invoices yet.</EmptyTitle>
              <EmptyDescription>
                Generate a numbered invoice and send its hosted payment page to your client.
              </EmptyDescription>
              <EmptyAction>
                <Button
                  onClick={() => {
                    resetCreate();
                    setCreating(true);
                  }}
                >
                  <PlusIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                  Generate invoice
                </Button>
              </EmptyAction>
            </Empty>
          ) : (
            <Table>
              <TableCaption>Invoices generated for your clients</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell>
                      <span className="font-mono text-xs">{invoice.number ?? "Draft"}</span>
                    </TableCell>
                    <TableCell>
                      <span className="flex max-w-52 flex-col">
                        <span className="truncate">{invoice.buyer.name}</span>
                        {invoice.buyer.email !== null && (
                          <span className="truncate text-xs text-subtle-foreground">
                            {invoice.buyer.email}
                          </span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="block max-w-52 truncate" title={lineSummary(invoice)}>
                        {lineSummary(invoice)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_TONE[invoice.status]}>
                        {STATUS_LABEL[invoice.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="flex flex-col items-end">
                        <span>{invoice.outstanding.display}</span>
                        {invoice.paid.amount !== "0" && (
                          <span className="text-xs text-success">{invoice.paid.display} paid</span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {invoice.dueAt === null ? (
                        "—"
                      ) : (
                        <time dateTime={isoAttr(invoice.dueAt)}>{formatDate(invoice.dueAt)}</time>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {invoice.state === "draft" ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            // Matches the 40px icon actions the other rows use,
                            // so the draft row's action group lines up with them.
                            className="h-10 px-5"
                            onClick={() => {
                              setIssuing(invoice);
                              setIssueDueDate("");
                            }}
                          >
                            Issue
                          </Button>
                        ) : (
                          <>
                            {/* The action sends a payment link, so it goes once
                                there is nothing left to pay. Mailing a client a
                                link to an invoice they already settled reads as
                                a second demand for the same money. A partly
                                paid or overdue invoice still owes something and
                                keeps it. */}
                            {invoice.buyer.email !== null && invoice.status !== "paid" && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-10"
                                aria-label={`Email ${invoice.number ?? invoice.id} to ${invoice.buyer.email}`}
                                onClick={() => {
                                  setCopied(false);
                                  setEmailed(false);
                                  setSharing(invoice);
                                }}
                              >
                                <PaperPlaneTiltIcon
                                  size={ICON_NAV}
                                  weight="bold"
                                  aria-hidden="true"
                                />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-10"
                              aria-label={`Copy payment link for ${invoice.number ?? invoice.id}`}
                              onClick={() => void copyLink(invoice)}
                            >
                              <CopyIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                            </Button>
                            <a
                              href={invoice.url}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={`Open ${invoice.number ?? invoice.id}`}
                              className={cn(
                                buttonVariants({ variant: "ghost", size: "icon" }),
                                "size-10",
                              )}
                            >
                              <ArrowSquareOutIcon
                                size={ICON_NAV}
                                weight="bold"
                                aria-hidden="true"
                              />
                            </a>
                          </>
                        )}
                        {(invoice.status === "draft" ||
                          invoice.status === "issued" ||
                          invoice.status === "overdue") && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-10"
                            aria-label={`Void ${invoice.number ?? invoice.id}`}
                            onClick={() => setPendingVoid(invoice)}
                          >
                            <TrashIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ),
        )}

      <Dialog open={creating} onOpenChange={(next) => setCreating(next)}>
        <DialogContent className="max-h-[calc(100vh-2rem)] max-w-3xl overflow-y-auto p-5">
          <DialogHeader>
            <DialogTitle>Generate invoice</DialogTitle>
            <DialogDescription>
              The invoice is numbered and issued immediately. Its prices freeze here, then your
              client chooses a supported crypto asset on the payment page.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="invoice-buyer-name">Client name</FieldLabel>
              <Input
                id="invoice-buyer-name"
                value={draft.buyerName}
                onChange={(event) => setDraft({ ...draft, buyerName: event.target.value })}
                autoComplete="organization"
                aria-required="true"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="invoice-buyer-email">Client email</FieldLabel>
              <Input
                id="invoice-buyer-email"
                type="email"
                value={draft.buyerEmail}
                onChange={(event) => setDraft({ ...draft, buyerEmail: event.target.value })}
                autoComplete="email"
                aria-invalid={!validEmail(draft.buyerEmail.trim())}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="invoice-tax-id">Tax ID / NPWP</FieldLabel>
              <Input
                id="invoice-tax-id"
                value={draft.buyerTaxId}
                onChange={(event) => setDraft({ ...draft, buyerTaxId: event.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="invoice-due-date">Due date</FieldLabel>
              <DatePicker
                id="invoice-due-date"
                value={draft.dueDate}
                onValueChange={(value) => setDraft({ ...draft, dueDate: value })}
              />
            </Field>
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="invoice-buyer-address">Billing address</FieldLabel>
              <Textarea
                id="invoice-buyer-address"
                value={draft.buyerAddress}
                onChange={(event) => setDraft({ ...draft, buyerAddress: event.target.value })}
                autoComplete="street-address"
              />
            </Field>
          </div>

          <fieldset className="flex flex-col gap-3 border-t border-border pt-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <legend className="text-sm font-medium text-foreground">Line items</legend>
                <p className="text-xs text-subtle-foreground">
                  Amounts are exact and stay unchanged after issue.
                </p>
              </div>
              <div className="w-full sm:w-44">
                <Field>
                  <FieldLabel htmlFor="invoice-currency">Currency</FieldLabel>
                  <Select
                    items={CURRENCY_OPTIONS}
                    value={draft.currency}
                    onValueChange={(value) => setDraft({ ...draft, currency: value })}
                  >
                    <SelectTrigger id="invoice-currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCY_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </div>

            {draft.lines.map((line, index) => (
              <div
                key={line.id}
                className="grid gap-3 rounded-lg border border-border bg-card p-3 sm:grid-cols-[minmax(0,1fr)_11rem_6rem_auto] sm:items-end"
              >
                <Field>
                  <FieldLabel htmlFor={`invoice-line-name-${line.id}`}>Item {index + 1}</FieldLabel>
                  <Input
                    id={`invoice-line-name-${line.id}`}
                    value={line.name}
                    onChange={(event) => updateLine(line.id, { name: event.target.value })}
                    placeholder="Service or product"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`invoice-line-price-${line.id}`}>Unit price</FieldLabel>
                  <CurrencyInput
                    id={`invoice-line-price-${line.id}`}
                    asset={draft.currency}
                    value={line.amount}
                    onValueChange={(amount) => updateLine(line.id, { amount })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`invoice-line-quantity-${line.id}`}>Quantity</FieldLabel>
                  <Input
                    id={`invoice-line-quantity-${line.id}`}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={line.quantity}
                    onChange={(event) => updateLine(line.id, { quantity: event.target.value })}
                  />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-10"
                  aria-label={`Remove item ${index + 1}`}
                  disabled={draft.lines.length === 1}
                  onClick={() => removeLine(line.id)}
                >
                  <TrashIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="secondary" className="self-start" onClick={addLine}>
              <PlusIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
              Add line
            </Button>
          </fieldset>

          <Field>
            <FieldLabel htmlFor="invoice-notes">Notes</FieldLabel>
            <Textarea
              id="invoice-notes"
              value={draft.notes}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
              placeholder="Payment terms or a message for the client"
              maxLength={2_000}
            />
            <FieldDescription>Shown on the client&apos;s invoice.</FieldDescription>
          </Field>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button
              disabled={!canCreate || create.isPending}
              onClick={() => void generateInvoice()}
            >
              {create.isPending ? "Generating…" : "Generate and issue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={sharing !== null}
        onOpenChange={(next) => {
          if (!next) {
            setSharing(null);
            setCopied(false);
            setEmailed(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{sharing?.number ?? "Invoice ready"}</DialogTitle>
            <DialogDescription>
              Send this link to {sharing?.buyer.name}. They can review the invoice and pay the
              outstanding balance from the hosted page.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="invoice-client-link">Client payment link</FieldLabel>
            <Input id="invoice-client-link" value={sharing?.url ?? ""} readOnly />
          </Field>
          {sharing?.buyer.email === null ? (
            <p className="text-sm text-muted-foreground">
              This invoice has no client email. Copy the payment link and send it manually.
            </p>
          ) : (
            <Button
              disabled={sendEmail.isPending || emailed}
              onClick={() => sharing !== null && void emailInvoice(sharing)}
            >
              {emailed ? (
                <CheckIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
              ) : (
                <PaperPlaneTiltIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
              )}
              {sendEmail.isPending ? "Sending…" : emailed ? "Email sent" : "Send by email"}
            </Button>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              variant="secondary"
              onClick={() => sharing !== null && void copyLink(sharing, true)}
            >
              {copied ? (
                <CheckIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
              ) : (
                <CopyIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
              )}
              {copied ? "Copied" : "Copy link"}
            </Button>
            {sharing !== null && (
              <a
                href={sharing.url}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ variant: "secondary" })}
              >
                <ArrowSquareOutIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
                Preview invoice
              </a>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={issuing !== null}
        onOpenChange={(next) => {
          if (!next) setIssuing(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Issue draft invoice</DialogTitle>
            <DialogDescription>
              Issuing allocates its permanent number and makes the client payment page payable.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="draft-due-date">Due date</FieldLabel>
            <DatePicker id="draft-due-date" value={issueDueDate} onValueChange={setIssueDueDate} />
          </Field>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setIssuing(null)}>
              Cancel
            </Button>
            <Button
              disabled={issueDueDate === "" || issue.isPending}
              onClick={() => void issueDraft()}
            >
              {issue.isPending ? "Issuing…" : "Issue invoice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingVoid !== null}
        onOpenChange={(next) => !next && setPendingVoid(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void this invoice?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingVoid?.number === null
                ? "This draft will be withdrawn and cannot be issued later."
                : `${pendingVoid?.number ?? "This invoice"} can no longer be paid. Its number remains in the accounting sequence and cannot be reused.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep invoice</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={voidInvoice.isPending}
              onClick={() => void confirmVoid()}
            >
              {voidInvoice.isPending ? "Voiding…" : "Void invoice"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

export default withQuery(Invoices);
