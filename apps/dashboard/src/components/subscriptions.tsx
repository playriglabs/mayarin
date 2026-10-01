/**
 * Subscriptions — recurring billing, send-to-pay (#296).
 *
 * A subscription bills a customer every week, month or year. Each cycle is an
 * ordinary invoice issued (and emailed, when the customer has an email) by the
 * billing tick; the customer pays it on any rail, exactly like a one-off
 * invoice. Pause stops billing and skips the missed periods on resume; cancel
 * is final.
 */

import {
  ArrowClockwiseIcon,
  ArrowSquareOutIcon,
  PauseIcon,
  PlusIcon,
  RepeatIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { match } from "ts-pattern";
import { Alert } from "@/components/ui/alert";
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
import { useCustomers } from "@/hooks/customers";
import {
  useCreateSubscription,
  useSubscriptionAction,
  useSubscriptionDetail,
  useSubscriptions,
} from "@/hooks/subscriptions";
import { ApiError } from "@/lib/api/client";
import { formatDate, isoAttr } from "@/lib/date";
import { ICON_CARD, ICON_NAV } from "@/lib/icons";
import { currencyLabel, isValidAmount, PRICING_CURRENCIES } from "@/lib/pricing";
import { withQuery } from "@/lib/with-query";
import type { InvoiceStatus } from "@/types/invoices";
import type {
  SubscriptionAction,
  SubscriptionDto,
  SubscriptionInterval,
  SubscriptionState,
} from "@/types/subscriptions";

const CURRENCY_OPTIONS: readonly SelectOption[] = PRICING_CURRENCIES.map((currency) => ({
  value: currency,
  label: currencyLabel(currency),
}));

const INTERVAL_OPTIONS: readonly { value: SubscriptionInterval; label: string }[] = [
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
  { value: "year", label: "Yearly" },
];

const INTERVAL_LABEL: Readonly<Record<SubscriptionInterval, string>> = {
  week: "Weekly",
  month: "Monthly",
  year: "Yearly",
};

const STATE_LABEL: Readonly<Record<SubscriptionState, string>> = {
  active: "Active",
  paused: "Paused",
  cancelled: "Cancelled",
};

const STATE_TONE: Readonly<Record<SubscriptionState, "success" | "warning" | "default">> = {
  active: "success",
  paused: "warning",
  cancelled: "default",
};

const CYCLE_LABEL: Readonly<Record<InvoiceStatus, string>> = {
  draft: "Draft",
  issued: "Awaiting payment",
  partially_paid: "Partially paid",
  paid: "Paid",
  overdue: "Overdue",
  void: "Void",
};

const CYCLE_TONE: Readonly<
  Record<InvoiceStatus, "default" | "warning" | "success" | "destructive">
> = {
  draft: "default",
  issued: "warning",
  partially_paid: "warning",
  paid: "success",
  overdue: "destructive",
  void: "default",
};

interface Draft {
  readonly customerId: string;
  readonly description: string;
  readonly currency: string;
  readonly amount: string;
  readonly interval: SubscriptionInterval;
  /** `YYYY-MM-DD`; empty bills the first cycle on the next tick. */
  readonly startDate: string;
  readonly daysUntilDue: string;
}

const EMPTY_DRAFT: Draft = {
  customerId: "",
  description: "",
  currency: PRICING_CURRENCIES[0] ?? "IDR",
  amount: "",
  interval: "month",
  startDate: "",
  daysUntilDue: "7",
};

function reasonOf(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong";
}

function validDays(value: string): boolean {
  return /^\d{1,2}$/.test(value) && Number(value) <= 90;
}

/** A future start bills at 08:00 in Jakarta on that day; today bills on the next tick. */
function startTimestamp(date: string): string | undefined {
  if (date === "" || date <= new Date().toISOString().slice(0, 10)) return undefined;
  return `${date}T01:00:00.000Z`;
}

function Subscriptions() {
  const subscriptions = useSubscriptions();
  const customers = useCustomers();
  const create = useCreateSubscription();
  const act = useSubscriptionAction();
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [viewing, setViewing] = useState<string | null>(null);
  const [failure, setFailure] = useState("");

  const customerOptions: readonly SelectOption[] = (customers.data?.customers ?? []).map(
    (customer) => ({
      value: customer.id,
      label: customer.email === null ? customer.name : `${customer.name} · ${customer.email}`,
    }),
  );
  const canCreate =
    draft.customerId !== "" &&
    draft.description.trim() !== "" &&
    isValidAmount(draft.amount, draft.currency) &&
    validDays(draft.daysUntilDue);

  function openCreate() {
    setDraft(EMPTY_DRAFT);
    setFailure("");
    setCreating(true);
  }

  async function submit() {
    setFailure("");
    const startAt = startTimestamp(draft.startDate);
    try {
      await create.mutateAsync({
        customerId: draft.customerId,
        description: draft.description.trim(),
        amount: { amount: draft.amount.trim(), asset: draft.currency },
        interval: draft.interval,
        daysUntilDue: Number(draft.daysUntilDue),
        ...(startAt === undefined ? {} : { startAt }),
      });
      setCreating(false);
    } catch (error) {
      setFailure(reasonOf(error));
    }
  }

  async function run(subscription: SubscriptionDto, action: SubscriptionAction) {
    setFailure("");
    try {
      await act.mutateAsync({ id: subscription.id, action });
    } catch (error) {
      setFailure(reasonOf(error));
    }
  }

  const rows = subscriptions.data?.subscriptions ?? [];

  return (
    <section className="flex flex-col gap-4">
      {failure !== "" && !creating && <Alert variant="destructive">{failure}</Alert>}

      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-xs text-subtle-foreground">
          {rows.length} subscription{rows.length === 1 ? "" : "s"}
        </p>
        <Button onClick={openCreate}>
          <PlusIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
          New subscription
        </Button>
      </div>

      {match(subscriptions)
        .with({ isPending: true }, () => <TableSkeleton rows={5} />)
        .with({ isError: true }, ({ error }) => (
          <QueryError
            message={reasonOf(error)}
            retry={() => void subscriptions.refetch()}
            retrying={subscriptions.isFetching}
          />
        ))
        .otherwise(() =>
          rows.length === 0 ? (
            <Empty>
              <EmptyMedia>
                <RepeatIcon size={ICON_CARD} aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No subscriptions yet.</EmptyTitle>
              <EmptyDescription>
                Bill a customer every week, month or year. Each cycle is an invoice they pay on any
                supported asset.
              </EmptyDescription>
              <EmptyAction>
                <Button onClick={openCreate}>New subscription</Button>
              </EmptyAction>
            </Empty>
          ) : (
            <Table>
              <TableCaption>Recurring billing, one invoice per cycle</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Next bill</TableHead>
                  <TableHead className="text-right">Cycles</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((subscription) => (
                  <TableRow key={subscription.id}>
                    <TableCell>
                      <span className="flex max-w-52 flex-col">
                        <span className="truncate">{subscription.subscriber.name}</span>
                        {subscription.subscriber.email !== null && (
                          <span className="truncate text-xs text-subtle-foreground">
                            {subscription.subscriber.email}
                          </span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="flex max-w-52 flex-col">
                        <span className="truncate">{subscription.description}</span>
                        <span className="text-xs text-subtle-foreground">
                          {INTERVAL_LABEL[subscription.interval]}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {subscription.amount.display}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATE_TONE[subscription.state]}>
                        {STATE_LABEL[subscription.state]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {subscription.nextBillingAt === null ? (
                        "—"
                      ) : (
                        <time dateTime={isoAttr(subscription.nextBillingAt)}>
                          {formatDate(subscription.nextBillingAt)}
                        </time>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <Button variant="ghost" size="sm" onClick={() => setViewing(subscription.id)}>
                        {subscription.billedCycles}
                      </Button>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {subscription.state === "active" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-10"
                            aria-label={`Pause ${subscription.description}`}
                            disabled={act.isPending}
                            onClick={() => void run(subscription, "pause")}
                          >
                            <PauseIcon size={ICON_NAV} aria-hidden="true" />
                          </Button>
                        )}
                        {subscription.state === "paused" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-10"
                            aria-label={`Resume ${subscription.description}`}
                            disabled={act.isPending}
                            onClick={() => void run(subscription, "resume")}
                          >
                            <ArrowClockwiseIcon size={ICON_NAV} aria-hidden="true" />
                          </Button>
                        )}
                        {subscription.state !== "cancelled" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-10"
                            aria-label={`Cancel ${subscription.description}`}
                            disabled={act.isPending}
                            onClick={() => void run(subscription, "cancel")}
                          >
                            <XIcon size={ICON_NAV} aria-hidden="true" />
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
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>New subscription</DialogTitle>
            <DialogDescription>
              Every cycle issues an invoice to the customer and emails its payment link when they
              have an email. They pay it on any supported asset.
            </DialogDescription>
          </DialogHeader>

          {failure !== "" && <Alert variant="destructive">{failure}</Alert>}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="subscription-customer">Customer</FieldLabel>
              <Select
                items={customerOptions}
                value={draft.customerId}
                onValueChange={(value) => setDraft({ ...draft, customerId: value })}
              >
                <SelectTrigger id="subscription-customer">
                  <SelectValue placeholder="Choose a customer" />
                </SelectTrigger>
                <SelectContent>
                  {customerOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {customers.status === "success" && customerOptions.length === 0 && (
                <FieldDescription>Add a customer on the Customers page first.</FieldDescription>
              )}
            </Field>
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="subscription-description">Plan</FieldLabel>
              <Input
                id="subscription-description"
                placeholder="Pro plan"
                maxLength={200}
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              />
              <FieldDescription>Printed on every cycle&apos;s invoice.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="subscription-currency">Currency</FieldLabel>
              <Select
                items={CURRENCY_OPTIONS}
                value={draft.currency}
                onValueChange={(value) => setDraft({ ...draft, currency: value })}
              >
                <SelectTrigger id="subscription-currency">
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
            <Field>
              <FieldLabel htmlFor="subscription-amount">Amount per cycle</FieldLabel>
              <CurrencyInput
                id="subscription-amount"
                asset={draft.currency}
                placeholder="49.000,00"
                value={draft.amount}
                onValueChange={(amount) => setDraft({ ...draft, amount })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="subscription-interval">Billing</FieldLabel>
              <Select
                items={INTERVAL_OPTIONS}
                value={draft.interval}
                onValueChange={(value) =>
                  setDraft({ ...draft, interval: value as SubscriptionInterval })
                }
              >
                <SelectTrigger id="subscription-interval">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INTERVAL_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="subscription-due">Days to pay</FieldLabel>
              <Input
                id="subscription-due"
                type="number"
                inputMode="numeric"
                min={0}
                max={90}
                value={draft.daysUntilDue}
                onChange={(event) => setDraft({ ...draft, daysUntilDue: event.target.value })}
                aria-invalid={!validDays(draft.daysUntilDue)}
              />
            </Field>
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="subscription-start">First bill</FieldLabel>
              <DatePicker
                id="subscription-start"
                value={draft.startDate}
                onValueChange={(value) => setDraft({ ...draft, startDate: value })}
              />
              <FieldDescription>
                Leave empty to bill the first cycle now. Later cycles follow on the same day.
              </FieldDescription>
            </Field>
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button disabled={!canCreate || create.isPending} onClick={() => void submit()}>
              {create.isPending ? "Creating…" : "Create subscription"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={viewing !== null} onOpenChange={(next) => !next && setViewing(null)}>
        <DialogContent className="max-w-2xl">
          <Cycles id={viewing} />
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** Every cycle's invoice, newest first, with its paid/overdue status and pay page. */
function Cycles({ id }: { readonly id: string | null }) {
  const detail = useSubscriptionDetail(id);
  return (
    <>
      <DialogHeader>
        <DialogTitle>{detail.data?.subscription.description ?? "Billing cycles"}</DialogTitle>
        <DialogDescription>One invoice per billed cycle.</DialogDescription>
      </DialogHeader>
      {match(detail)
        .with({ isPending: true }, () => <TableSkeleton rows={3} />)
        .with({ isError: true }, ({ error }) => (
          <QueryError
            message={reasonOf(error)}
            retry={() => void detail.refetch()}
            retrying={detail.isFetching}
          />
        ))
        .otherwise(({ data }) =>
          (data?.cycles ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No cycle has been billed yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Page</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.cycles ?? []).map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-mono text-xs">{invoice.number ?? "Draft"}</TableCell>
                    <TableCell>
                      <Badge variant={CYCLE_TONE[invoice.status]}>
                        {CYCLE_LABEL[invoice.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {invoice.total.display}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {invoice.dueAt === null ? (
                        "—"
                      ) : (
                        <time dateTime={isoAttr(invoice.dueAt)}>{formatDate(invoice.dueAt)}</time>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <a
                        href={invoice.url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open invoice ${invoice.number ?? ""}`}
                        className={buttonVariants({ variant: "ghost", size: "icon" })}
                      >
                        <ArrowSquareOutIcon size={ICON_NAV} aria-hidden="true" />
                      </a>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ),
        )}
    </>
  );
}

export default withQuery(Subscriptions);
