import { type ChangeEvent, type FormEvent, useMemo, useState } from "react";
import { mintCheckoutLink } from "./checkout.ts";
import { type CheckoutDraft, clearDraft, loadDraft } from "./checkout-draft.ts";
import { formatIdrMinorUnits } from "./money.ts";
import { addOrder, mostRecentShippingAddress, newOrderId, type Order } from "./orders.ts";
import { CURRENCY } from "./ProductCard.tsx";
import { navigate } from "./route.ts";
import type { CatalogState } from "./types.ts";

const REQUIRED_FIELDS = [
  "recipientName",
  "phone",
  "addressLine1",
  "city",
  "state",
  "postalCode",
  "country",
] as const;

type RequiredField = (typeof REQUIRED_FIELDS)[number];
type AddressForm = Record<RequiredField, string> & { addressLine2: string; notes: string };

const EMPTY_FORM: AddressForm = {
  recipientName: "",
  phone: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "",
  notes: "",
};

const FIELD_LABELS: Record<RequiredField, string> = {
  recipientName: "Recipient name",
  phone: "Phone number",
  addressLine1: "Address line 1",
  city: "City",
  state: "State / province / region",
  postalCode: "Postal code",
  country: "Country",
};

/** International phone numbers: optional `+` and country code, 7–15 digits. */
function isInternationalPhone(raw: string): boolean {
  return /^\+?[1-9]\d{6,14}$/.test(raw.replace(/[\s\-().]/g, ""));
}

/** Postal codes worldwide: 2–10 letters, digits, spaces, or hyphens. */
function isPlausiblePostalCode(raw: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9 -]{1,9})?$/.test(raw.trim());
}

function validate(form: AddressForm): Partial<Record<RequiredField, string>> {
  const errors: Partial<Record<RequiredField, string>> = {};
  for (const field of REQUIRED_FIELDS) {
    if (form[field].trim() === "") errors[field] = "This field is required.";
  }
  if (errors.phone === undefined && !isInternationalPhone(form.phone)) {
    errors.phone = "Use the full number with country code, e.g. +62 812 3456 7890.";
  }
  if (errors.postalCode === undefined && !isPlausiblePostalCode(form.postalCode)) {
    errors.postalCode = "Postal code looks wrong — 2 to 10 letters or digits.";
  }
  return errors;
}

function Field({
  id,
  label,
  placeholder,
  value,
  error,
  showErrors,
  multiline,
  onChange,
  onBlur,
}: {
  readonly id: string;
  readonly label: string;
  readonly placeholder?: string;
  readonly value: string;
  readonly error: string | undefined;
  readonly showErrors: boolean;
  readonly multiline?: boolean;
  readonly onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  readonly onBlur?: () => void;
}) {
  const describedBy = showErrors && error !== undefined ? `${id}-error` : undefined;
  return (
    <p className="field">
      <label htmlFor={id}>{label}</label>
      {multiline === true ? (
        <textarea
          id={id}
          value={value}
          rows={3}
          placeholder={placeholder}
          onChange={onChange}
          onBlur={onBlur}
          aria-describedby={describedBy}
        />
      ) : (
        <input
          id={id}
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={onChange}
          onBlur={onBlur}
          aria-describedby={describedBy}
        />
      )}
      {showErrors && error !== undefined && (
        <span className="field-error" id={`${id}-error`}>
          {error}
        </span>
      )}
    </p>
  );
}

type SubmitState =
  | { readonly status: "idle" }
  | { readonly status: "submitting" }
  | { readonly status: "error"; readonly message: string };

/**
 * The shipping step both entry points converge on. The draft carries the
 * lines; the catalog carries the names and prices. Continue runs the one
 * checkout handler — mint the payment link, persist the order, then hand
 * the browser to the history with the new order highlighted.
 */
export function ShippingPage({
  catalog,
  onCartCleared,
}: {
  readonly catalog: CatalogState;
  /** Runs after a cart-sourced order is placed; a buy-now order clears nothing. */
  readonly onCartCleared: () => void;
}) {
  const [draft] = useState<CheckoutDraft | null>(loadDraft);
  const [form, setForm] = useState<AddressForm>(() => {
    const recent = mostRecentShippingAddress();
    return {
      ...EMPTY_FORM,
      ...(recent === null
        ? {}
        : {
            recipientName: recent.recipientName,
            phone: recent.phone,
            addressLine1: recent.addressLine1,
            addressLine2: recent.addressLine2 ?? "",
            city: recent.city,
            state: recent.state,
            postalCode: recent.postalCode,
            country: recent.country,
            ...(recent.notes !== undefined ? { notes: recent.notes } : {}),
          }),
    };
  });
  const [touched, setTouched] = useState<readonly RequiredField[]>([]);
  const [state, setState] = useState<SubmitState>({ status: "idle" });

  const products = catalog.status === "ready" ? catalog.products : [];
  /** Draft lines joined against the catalog; a product that is gone drops out. */
  const lines = useMemo(
    () =>
      (draft?.items ?? []).flatMap((line) => {
        const product = products.find((p) => p.id === line.productId);
        return product === undefined ? [] : [{ product, quantity: line.quantity }];
      }),
    [draft, products],
  );
  // While the catalog loads every draft line is "missing" — only a loaded
  // catalog can say an item is really gone.
  const missingItems = catalog.status === "ready" && (draft?.items.length ?? 0) > lines.length;
  const subtotal = lines.reduce(
    (sum, line) =>
      sum +
      BigInt(line.product.prices.find((entry) => entry.asset === CURRENCY)?.amount ?? "0") *
        BigInt(line.quantity),
    0n,
  );

  const errors = validate(form);
  const valid = Object.keys(errors).length === 0;
  const canPlace = valid && !missingItems && lines.length > 0;
  const fieldTouched = (field: RequiredField) => touched.includes(field);
  const markTouched = (field: RequiredField) =>
    setTouched((current) => (current.includes(field) ? current : [...current, field]));
  const set =
    (field: RequiredField | "addressLine2" | "notes") =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((current) => ({ ...current, [field]: event.target.value }));

  async function placeOrder(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (draft === null || !canPlace || state.status === "submitting") return;
    setState({ status: "submitting" });
    try {
      const link = await mintCheckoutLink(
        draft.items.map((line) => ({ productId: line.productId, quantity: line.quantity })),
      );
      const order: Order = {
        id: newOrderId(),
        createdAt: Date.now(),
        items: lines.map((line) => ({
          productId: line.product.id,
          name: line.product.name,
          unitPrice: line.product.prices.find((entry) => entry.asset === CURRENCY)?.amount ?? "0",
          qty: line.quantity,
        })),
        subtotal: subtotal.toString(),
        shipping: {
          recipientName: form.recipientName.trim(),
          phone: form.phone.trim(),
          addressLine1: form.addressLine1.trim(),
          ...(form.addressLine2.trim() === "" ? {} : { addressLine2: form.addressLine2.trim() }),
          city: form.city.trim(),
          state: form.state.trim(),
          postalCode: form.postalCode.trim(),
          country: form.country.trim(),
          ...(form.notes.trim() === "" ? {} : { notes: form.notes.trim() }),
        },
        status: "pending_payment",
        source: draft.source,
        linkId: link.id,
        paymentUrl: link.url,
      };
      addOrder(order);
      if (draft.source === "cart") onCartCleared();
      clearDraft();
      navigate(`/history?new=${order.id}`);
    } catch (error) {
      setState({
        status: "error",
        message:
          error instanceof Error
            ? `Checkout could not be prepared. ${error.message}`
            : "Checkout could not be prepared.",
      });
    }
  }

  function goBack(): void {
    // The draft stays parked, so the cart and the abandoned flow are intact.
    if (window.history.length > 1) window.history.back();
    else navigate("/");
  }

  if (draft === null) {
    return (
      <main className="page">
        <div className="state-panel">
          <p className="notice">There is no checkout in progress on this device.</p>
          <a className="see-all mt-4" href="/">
            Back to the collection
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="page" id="pengiriman">
      <p className="kicker">Checkout</p>
      <h2 className="mt-2">Shipping details</h2>
      <p className="notice mt-4">
        Where should the order go? The payment itself runs on Mayarin — the address never leaves
        this device.
      </p>

      <div className="checkout-grid">
        <form className="checkout-form" noValidate onSubmit={(event) => void placeOrder(event)}>
          <Field
            id="recipientName"
            label={FIELD_LABELS.recipientName}
            placeholder="Full name of the person receiving the order"
            value={form.recipientName}
            error={errors.recipientName}
            showErrors={fieldTouched("recipientName")}
            onChange={set("recipientName")}
            onBlur={() => markTouched("recipientName")}
          />
          <Field
            id="phone"
            label={FIELD_LABELS.phone}
            placeholder="Include the country code, e.g. +62 812 3456 7890"
            value={form.phone}
            error={errors.phone}
            showErrors={fieldTouched("phone")}
            onChange={set("phone")}
            onBlur={() => markTouched("phone")}
          />
          <Field
            id="addressLine1"
            label={FIELD_LABELS.addressLine1}
            placeholder="Street and number, e.g. Jl. Braga No. 2"
            value={form.addressLine1}
            error={errors.addressLine1}
            showErrors={fieldTouched("addressLine1")}
            onChange={set("addressLine1")}
            onBlur={() => markTouched("addressLine1")}
          />
          <Field
            id="addressLine2"
            label="Address line 2 (optional)"
            placeholder="Apartment, suite, unit, or landmark"
            value={form.addressLine2}
            error={undefined}
            showErrors={false}
            onChange={set("addressLine2")}
          />
          <div className="form-row">
            <Field
              id="city"
              label={FIELD_LABELS.city}
              placeholder="e.g. Bandung"
              value={form.city}
              error={errors.city}
              showErrors={fieldTouched("city")}
              onChange={set("city")}
              onBlur={() => markTouched("city")}
            />
            <Field
              id="state"
              label={FIELD_LABELS.state}
              placeholder="e.g. West Java"
              value={form.state}
              error={errors.state}
              showErrors={fieldTouched("state")}
              onChange={set("state")}
              onBlur={() => markTouched("state")}
            />
          </div>
          <div className="form-row">
            <Field
              id="postalCode"
              label={FIELD_LABELS.postalCode}
              placeholder="e.g. 40111"
              value={form.postalCode}
              error={errors.postalCode}
              showErrors={fieldTouched("postalCode")}
              onChange={set("postalCode")}
              onBlur={() => markTouched("postalCode")}
            />
            <Field
              id="country"
              label={FIELD_LABELS.country}
              placeholder="e.g. Indonesia"
              value={form.country}
              error={errors.country}
              showErrors={fieldTouched("country")}
              onChange={set("country")}
              onBlur={() => markTouched("country")}
            />
          </div>
          <Field
            id="notes"
            label="Delivery notes (optional)"
            placeholder="Where to leave the package, delivery windows, landmarks…"
            value={form.notes}
            error={undefined}
            showErrors={false}
            multiline
            onChange={set("notes")}
          />

          <div className="checkout-actions">
            <button type="button" className="btn-secondary" onClick={goBack}>
              Back
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={!canPlace || state.status === "submitting"}
              aria-busy={state.status === "submitting"}
            >
              {state.status === "submitting" ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  Preparing…
                </>
              ) : (
                "Continue"
              )}
            </button>
          </div>
          {state.status === "error" && (
            <p className="notice error" role="alert">
              {state.message}
            </p>
          )}
        </form>

        <aside className="order-summary" aria-label="Order summary">
          <p className="kicker">Your order</p>
          <h3>Order summary</h3>
          {catalog.status !== "ready" && <p className="notice mt-2">Loading the catalog…</p>}
          {missingItems && (
            <p className="notice error mt-2" role="alert">
              Some items in this checkout are no longer in the catalog.
            </p>
          )}
          <ul>
            {lines.map((line) => (
              <li key={line.product.id}>
                <span>
                  {line.product.name} × {line.quantity}
                </span>
                <span className="tabular-nums">
                  {formatIdrMinorUnits(
                    BigInt(
                      line.product.prices.find((entry) => entry.asset === CURRENCY)?.amount ?? "0",
                    ) * BigInt(line.quantity),
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p className="order-subtotal">
            <span>Subtotal</span>
            <strong className="price">{formatIdrMinorUnits(subtotal)}</strong>
          </p>
          {draft.source === "buy_now" && (
            <p className="notice mt-2">This order skips the cart — it was started with Buy now.</p>
          )}
        </aside>
      </div>
    </main>
  );
}
