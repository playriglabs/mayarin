import { type ChangeEvent, useEffect, useId, useState } from "react";
import { Dropdown } from "../../shared/dropdown.tsx";
import { errorText, fieldLabel, noteText, panelIntro, primaryButton } from "../../shared/ui.ts";
import { parseBirthDate } from "./birth-date.ts";
import { availableMarkets, flagEmoji, type Market, pickMarket } from "./markets.ts";

/**
 * Pay in a local rail instead of sending crypto: GCash, QRIS, FPX, bank
 * transfer. TransFi takes the local payment and delivers the stablecoin to the
 * address this payment already has, so the page keeps watching the same deposit
 * and nothing about settlement changes — when the stablecoin lands, the status
 * stream above flips this page to its confirming and paid states by itself.
 *
 * Laid out like a card form: contact first, then the method as tiles, then only
 * what that method needs. What the payer is told to do — a QR to scan, or a
 * virtual-account number — is drawn here rather than on TransFi's page; a method
 * TransFi cannot hand back that way opens its hosted page instead.
 *
 * TransFi will not take an order without the payer's identity. It is sent
 * straight through and Mayarin keeps none of it.
 *
 * Renders nothing when the deployment has no TransFi configured.
 */

interface Method {
  readonly code: string;
  readonly type: string;
  readonly name: string;
  readonly logoUrl: string | null;
}

type Instructions =
  | { readonly kind: "qr"; readonly value: string }
  | { readonly kind: "va"; readonly code: string; readonly bank: string | null }
  | { readonly kind: "redirect"; readonly url: string }
  | { readonly kind: "waiting" };

interface Created {
  /** The method the payer chose, with its mark — shown on the instruction it produced. */
  readonly method: { readonly name: string; readonly logoUrl: string | null };
  readonly instructions: Instructions;
  readonly fiatAmount: number;
  readonly fiatCurrency: string;
}

interface Contact {
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone: string;
  readonly phoneCode: string;
}

/** Set once TransFi has sent the payer a link to confirm their email. */
interface Confirmation {
  readonly userId: string;
  readonly token: string;
  readonly contact: Contact;
}

type MethodsState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly methods: readonly Method[] }
  | { readonly status: "error"; readonly message: string };

type Availability = "unknown" | "enabled" | "disabled";

/** The tile that stands for every bank in the list, which would be too many tiles. */
const BANK = "bank";

/** A label for a dense form: small and quiet, so four rows fit one screen. */
const compactLabel = "mb-1 block text-xs text-muted";

const inputClass =
  "block min-h-11 w-full rounded-xl border border-transparent bg-field px-4 text-sm text-ink placeholder:text-subtle focus:border-muted focus:outline-0 disabled:opacity-40";

function formatFiat(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("id-ID", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

export function LocalCurrencyCard({
  intentId,
  priceCurrency,
  delivery,
  leading = false,
  onChoose,
}: {
  readonly intentId: string;
  /** Where the payment is delivered, e.g. "USDC on Base"; shown under the intro. */
  readonly delivery?: string;
  /** What the merchant priced in. The payer most likely pays in the same one. */
  readonly priceCurrency: string;
  /** The payer chose local currency on the page before: show the form, not a fold. */
  readonly leading?: boolean;
  /** Without `leading`: what the button does — the page switches to local currency. */
  readonly onChoose?: () => void;
}) {
  const [availability, setAvailability] = useState<Availability>("unknown");
  const [open, setOpen] = useState(leading);
  // The markets the provider can take, asked of it; and which one the payer is in.
  const [markets, setMarkets] = useState<readonly Market[]>([]);
  const [currency, setCurrency] = useState<string | undefined>(undefined);
  const picked = pickMarket(markets, {
    currency: currency ?? priceCurrency,
    locale: navigator.language,
  });
  const [changing, setChanging] = useState(false);
  // Method first, then who is paying: the details are asked only once the payer
  // has said how, so the first screen is short and the second is only ever about them.
  const [step, setStep] = useState<"method" | "details">("method");
  const [methods, setMethods] = useState<MethodsState>({ status: "loading" });
  const [choice, setChoice] = useState("");
  const [bankCode, setBankCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<Confirmation | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);
  const panelId = useId();

  // Asked once on mount, so a deployment without TransFi never shows the option.
  useEffect(() => {
    let cancelled = false;
    fetch("/v1/fiat-onramp/currencies")
      .then(async (response) => {
        if (cancelled) return;
        if (!response.ok) {
          setAvailability("disabled");
          return;
        }
        const body = (await response.json()) as { currencies: string[] };
        const available = availableMarkets(body.currencies);
        setMarkets(available);
        setAvailability(available.length > 0 ? "enabled" : "disabled");
      })
      .catch(() => {
        if (!cancelled) setAvailability("disabled");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A payer who already opened an order and came back — the hosted TransFi page
  // returns here — is waiting on it, not choosing a method again.
  useEffect(() => {
    let cancelled = false;
    fetch(`/v1/fiat-onramp/${intentId}/funding`)
      .then(async (response) => {
        if (cancelled || !response.ok) return;
        const body = (await response.json()) as {
          funding: {
            methodName: string;
            methodLogoUrl: string | null;
            fiatCurrency: string;
            fiatAmount: number;
          } | null;
        };
        if (body.funding === null) return;
        setOpen(true);
        setCreated({
          method: { name: body.funding.methodName, logoUrl: body.funding.methodLogoUrl },
          instructions: { kind: "waiting" },
          fiatAmount: body.funding.fiatAmount,
          fiatCurrency: body.funding.fiatCurrency,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [intentId]);

  const marketCurrency = picked?.currency;
  useEffect(() => {
    if (!open || marketCurrency === undefined) return;
    let cancelled = false;
    setMethods({ status: "loading" });
    setChoice("");
    setBankCode("");
    fetch(`/v1/fiat-onramp/methods?currency=${marketCurrency}`)
      .then(async (response) => {
        const body = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          setMethods({
            status: "error",
            message: body?.error?.message ?? "Local payment is unavailable right now",
          });
          return;
        }
        setMethods({ status: "ready", methods: body.methods as readonly Method[] });
      })
      .catch(() => {
        if (!cancelled) setMethods({ status: "error", message: "Network error. Try again." });
      });
    return () => {
      cancelled = true;
    };
  }, [open, marketCurrency]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  // The payer chose local currency, so the panel is the whole page: a blank
  // right-hand side while the markets load reads as broken.
  if (leading && availability === "unknown") {
    return (
      <div className="mt-8 flex items-center gap-3.5 py-6" role="status">
        <span
          className="size-5.5 shrink-0 animate-spin rounded-full border-2 border-line border-t-ink motion-reduce:animate-none"
          aria-hidden="true"
        />
        <p className="m-0 text-sm text-muted">Loading payment methods…</p>
      </div>
    );
  }
  if (availability !== "enabled" || picked === undefined) return null;
  const market: Market = picked;

  const all = methods.status === "ready" ? methods.methods : [];
  const wallets = all.filter((method) => method.type !== "bank_transfer");
  const banks = all.filter((method) => method.type === "bank_transfer");
  const selected =
    choice === BANK
      ? banks.find((method) => method.code === bankCode)
      : all.find((method) => method.code === choice);

  /**
   * One call to the order route. `identity` is the full payer on the first call
   * and the confirmation token on the second; `contact` is the subset a method
   * asks for, kept so the second call can send it without the full identity.
   */
  async function send(identity: object, contact: Contact) {
    if (selected === undefined) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/v1/fiat-onramp/${intentId}/order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currency: market.currency,
          paymentCode: selected.code,
          paymentType: selected.type,
          ...identity,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body?.error?.message ?? "We could not start this payment");
        setBusy(false);
        return;
      }
      if (body.status === "verification-required") {
        // Asked again after the link was already followed means the check is
        // still running, which reads differently from the first ask.
        if (pending !== null) {
          setError("Your email is not confirmed yet. Open the link we sent, then try again.");
        }
        setPending({ userId: body.userId, token: body.token, contact });
        setBusy(false);
        return;
      }

      const instructions = body.instructions as Instructions;
      if (instructions.kind === "redirect") {
        // A method TransFi cannot hand back as a QR or an account number: its
        // hosted page takes the payment, then returns here.
        // Only a web page: the URL came from a payment provider's response.
        if (!/^https:\/\//i.test(instructions.url)) {
          setError("This payment method could not be opened. Try another.");
          setBusy(false);
          return;
        }
        window.location.href = instructions.url;
        return;
      }
      setCreated({
        method: { name: selected.name, logoUrl: selected.logoUrl },
        instructions,
        fiatAmount: body.fiatAmount as number,
        fiatCurrency: body.fiatCurrency as string,
      });
      setBusy(false);
    } catch {
      setError("Network error. Please try again.");
      setBusy(false);
    }
  }

  function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    const text = (name: string) => String(data.get(name) ?? "").trim();
    const contact: Contact = {
      firstName: text("firstName"),
      lastName: text("lastName"),
      email: text("email"),
      phone: text("phone").replace(/\D/g, "").replace(/^0+/, ""),
      phoneCode: market.phoneCode,
    };
    const dateOfBirth = parseBirthDate(text("dobDay"), text("dobMonth"), text("dobYear"));
    if (dateOfBirth === undefined) {
      setError("Enter your date of birth as day, month and year.");
      return;
    }
    setError("");
    void send(
      {
        payer: {
          ...contact,
          country: market.country,
          dateOfBirth,
          address: { city: text("city") },
        },
      },
      contact,
    );
  }

  const body = (
    <div id={panelId} hidden={!open} className={leading ? "mt-4" : "pb-5"}>
      {created !== null ? (
        <Instruction
          created={created}
          copied={copied}
          onCopy={(value) => {
            void navigator.clipboard.writeText(value);
            setCopied(true);
          }}
        />
      ) : pending !== null ? (
        <div role="status">
          <h3 className="m-0 text-sm font-medium text-ink">Confirm your email</h3>
          <p className="mt-1.5 mb-0 text-sm text-muted">
            We sent a link to{" "}
            <strong className="font-medium text-ink">{pending.contact.email}</strong>. Open it to
            confirm, then come back and continue. The link works for 10 minutes.
          </p>
          <button
            type="button"
            className={`${primaryButton} mt-5`}
            disabled={busy}
            onClick={() =>
              void send(
                { userId: pending.userId, token: pending.token, contact: pending.contact },
                pending.contact,
              )
            }
          >
            {busy ? "Checking…" : "I have confirmed — continue"}
          </button>
          {error !== "" && (
            <p className={errorText} role="alert">
              {error}
            </p>
          )}
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (step === "method") {
              if (selected !== undefined) setStep("details");
              return;
            }
            submit(event.currentTarget);
          }}
        >
          {step === "method" ? (
            <>
              {methods.status === "loading" && (
                <p className="m-0 text-xs text-muted" role="status">
                  Loading payment methods…
                </p>
              )}
              {methods.status === "error" && (
                <p className={errorText} role="alert">
                  {methods.message}
                </p>
              )}
              {methods.status === "ready" && (
                <>
                  <div>
                    {changing ? (
                      <Dropdown
                        label="Pay in"
                        value={market.currency}
                        disabled={busy}
                        onSelect={setCurrency}
                        options={markets.map((entry) => ({
                          value: entry.currency,
                          title: entry.label.replace(/ \(.*\)$/, ""),
                          subtitle: entry.currency,
                          mark: () => <span aria-hidden="true">{flagEmoji(entry.country)}</span>,
                        }))}
                      />
                    ) : (
                      <p className="m-0 flex items-baseline justify-between gap-4 text-sm text-muted">
                        <span>
                          Paying in{" "}
                          <strong className="font-medium text-ink">
                            <span aria-hidden="true">{flagEmoji(market.country)}</span>{" "}
                            {market.label}
                          </strong>
                        </span>
                        <button
                          type="button"
                          className="border-0 bg-transparent p-0 text-xs text-muted underline underline-offset-2 transition-colors hover:text-ink disabled:opacity-40"
                          disabled={busy}
                          onClick={() => setChanging(true)}
                        >
                          Change
                        </button>
                      </p>
                    )}
                  </div>

                  <fieldset className="m-0 mt-5 min-w-0 border-0 p-0">
                    <legend className={fieldLabel}>Payment method</legend>
                    <div className="grid grid-cols-2 gap-3">
                      {wallets.map((method) => (
                        <MethodTile
                          key={method.code}
                          label={method.name}
                          logoUrl={method.logoUrl}
                          selected={choice === method.code}
                          onSelect={() => setChoice(method.code)}
                        />
                      ))}
                      {banks.length > 0 && (
                        <MethodTile
                          label="Bank transfer"
                          selected={choice === BANK}
                          onSelect={() => setChoice(BANK)}
                        />
                      )}
                    </div>
                  </fieldset>

                  {choice === BANK && (
                    <Dropdown
                      className="mt-4"
                      label="Bank"
                      placeholder="Choose your bank"
                      value={bankCode}
                      disabled={busy}
                      onSelect={setBankCode}
                      options={banks.map((bank) => ({
                        value: bank.code,
                        title: bank.name,
                        mark: (size: number) => <MethodLogo url={bank.logoUrl} size={size} />,
                      }))}
                    />
                  )}

                  <button
                    type="submit"
                    className={`${primaryButton} mt-8`}
                    disabled={selected === undefined}
                  >
                    Continue
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <p className="m-0 flex items-center justify-between gap-4 text-sm text-muted">
                <span className="inline-flex items-center gap-2.5">
                  <MethodLogo url={selected?.logoUrl ?? null} size={28} />
                  <span>
                    <strong className="font-medium text-ink">{selected?.name}</strong> ·{" "}
                    {market.currency}
                  </span>
                </span>
                <button
                  type="button"
                  className="border-0 bg-transparent p-0 text-xs text-muted underline underline-offset-2 transition-colors hover:text-ink disabled:opacity-40"
                  disabled={busy}
                  onClick={() => setStep("method")}
                >
                  Back
                </button>
              </p>

              <fieldset className="m-0 mt-4 min-w-0 border-0 p-0" disabled={busy}>
                <legend className="sr-only">Your details</legend>
                <div className="grid gap-3">
                  <Field
                    id={panelId}
                    name="email"
                    label="Email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <Field
                      id={panelId}
                      name="firstName"
                      label="First name"
                      autoComplete="given-name"
                      placeholder="First name"
                    />
                    <Field
                      id={panelId}
                      name="lastName"
                      label="Last name"
                      autoComplete="family-name"
                      placeholder="Last name"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <DateOfBirthField />
                    <Field
                      id={panelId}
                      name="city"
                      label="City"
                      autoComplete="address-level2"
                      placeholder={market.cityExample}
                    />
                  </div>
                  <div>
                    <label className={compactLabel} htmlFor={`${panelId}-phone`}>
                      Phone
                    </label>
                    <div className="flex gap-2">
                      <span
                        className="flex min-h-11 w-16 shrink-0 items-center justify-center rounded-xl bg-field text-sm text-muted"
                        aria-hidden="true"
                      >
                        {market.phoneCode}
                      </span>
                      <input
                        id={`${panelId}-phone`}
                        name="phone"
                        type="tel"
                        inputMode="numeric"
                        required
                        autoComplete="tel-national"
                        placeholder={market.phoneExample}
                        className={`${inputClass} min-w-0 flex-1`}
                      />
                    </div>
                  </div>
                </div>
              </fieldset>

              <button type="submit" className={`${primaryButton} mt-5`} disabled={busy}>
                {busy ? "Opening payment…" : "Pay now"}
              </button>
              {error !== "" && (
                <p className={errorText} role="alert">
                  {error}
                </p>
              )}
              <p className="mt-3 mb-0 text-center text-[11px] leading-snug text-muted">
                Our payment partner verifies your identity and takes the payment. Mayarin passes
                these details on and keeps none of them.
              </p>
            </>
          )}
        </form>
      )}
    </div>
  );

  if (leading) {
    return (
      <section aria-label="Pay in local currency">
        {step === "method" && created === null && pending === null && (
          <p className={panelIntro}>
            Pay with an e-wallet, QRIS or bank transfer — no crypto wallet needed.
            {delivery !== undefined && <> Delivered to the merchant as {delivery}.</>}
          </p>
        )}
        {body}
      </section>
    );
  }

  // Beside the crypto instructions the option is a plain link, the mirror of
  // "Pay with crypto instead": the form does not fit under a deposit card, so
  // choosing it opens the page that leads with local currency.
  return (
    <button
      type="button"
      className="mt-4 block w-full border-0 bg-transparent p-0 text-center text-xs text-muted underline underline-offset-2 transition-colors hover:text-ink"
      onClick={onChoose}
    >
      Pay in local currency instead
    </button>
  );
}

/** What to do to pay, drawn here: a QR to scan or an account to transfer to. */
function Instruction({
  created,
  copied,
  onCopy,
}: {
  readonly created: Created;
  readonly copied: boolean;
  readonly onCopy: (value: string) => void;
}) {
  const { instructions, fiatAmount, fiatCurrency, method } = created;
  const amount = formatFiat(fiatAmount, fiatCurrency);

  return (
    <div role="status" className="flex flex-col items-center text-center">
      {instructions.kind === "qr" && (
        <>
          <h3 className="m-0 text-base font-medium text-ink">Scan to pay</h3>
          <span className="mt-2 inline-flex items-center gap-2 text-sm text-muted">
            <MethodLogo url={method.logoUrl} size={22} />
            {method.name}
          </span>
          <div className="mt-4 rounded-xl bg-white p-3">
            <img
              className="block size-52"
              alt="QR code to pay"
              src={`/checkout/qr?value=${encodeURIComponent(instructions.value)}`}
            />
          </div>
          <p className="mt-4 mb-0 text-xs text-muted">
            Open your e-wallet or banking app and scan this code.
          </p>
        </>
      )}
      {instructions.kind === "waiting" && (
        <>
          <h3 className="m-0 text-base font-medium text-ink">Waiting for your payment</h3>
          <span className="mt-2 inline-flex items-center gap-2 text-sm text-muted">
            <MethodLogo url={method.logoUrl} size={22} />
            {method.name}
          </span>
        </>
      )}
      {instructions.kind === "va" && (
        <>
          <h3 className="mt-3 mx-0 mb-0 text-base font-medium text-ink">
            Transfer to this account
          </h3>
          <dl className="mt-4 w-full rounded-2xl border border-line p-4 text-left">
            {instructions.bank !== null && (
              <div className="flex items-baseline justify-between gap-4 py-1.5">
                <dt className="text-xs text-muted">Bank</dt>
                <dd className="m-0 inline-flex items-center gap-2 text-sm text-ink">
                  <MethodLogo url={method.logoUrl} size={22} />
                  {instructions.bank}
                </dd>
              </div>
            )}
            <div className="flex items-center justify-between gap-4 py-1.5">
              <dt className="text-xs text-muted">Virtual account</dt>
              <dd className="m-0 flex items-center gap-2 text-sm text-ink tabular-nums">
                <code>{instructions.code}</code>
                <button
                  type="button"
                  className="rounded-full border border-line bg-panel px-3 py-1 text-xs text-ink transition-colors hover:bg-field"
                  aria-label={copied ? "Account number copied" : "Copy the account number"}
                  onClick={() => onCopy(instructions.code)}
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </dd>
            </div>
          </dl>
        </>
      )}
      <div className="mt-5 flex w-full items-baseline justify-between gap-4 border-y border-line py-4">
        <span className="text-sm text-muted">Pay exactly</span>
        <strong className="text-xl font-medium tabular-nums">{amount}</strong>
      </div>
      <p className={`${noteText} text-center`}>
        This page updates by itself once your payment arrives. You do not need to do anything else.
      </p>
    </div>
  );
}

/**
 * Day, month and year as three short inputs. Each hands focus to the next as it
 * fills, so the whole date goes in without leaving the keyboard.
 */
function DateOfBirthField() {
  const take = (event: ChangeEvent<HTMLInputElement>, length: number, next?: string) => {
    const digits = event.target.value.replace(/\D/g, "");
    event.target.value = digits;
    if (next === undefined || digits.length < length) return;
    const target = event.target.form?.elements.namedItem(next);
    if (target instanceof HTMLInputElement) target.focus();
  };

  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className={compactLabel}>Date of birth</legend>
      <div className="grid grid-cols-[1fr_1fr_1.5fr] gap-1.5">
        <input
          name="dobDay"
          aria-label="Day"
          placeholder="DD"
          inputMode="numeric"
          autoComplete="bday-day"
          maxLength={2}
          required
          className={`${inputClass} text-center`}
          onChange={(event) => take(event, 2, "dobMonth")}
        />
        <input
          name="dobMonth"
          aria-label="Month"
          placeholder="MM"
          inputMode="numeric"
          autoComplete="bday-month"
          maxLength={2}
          required
          className={`${inputClass} text-center`}
          onChange={(event) => take(event, 2, "dobYear")}
        />
        <input
          name="dobYear"
          aria-label="Year"
          placeholder="YYYY"
          inputMode="numeric"
          autoComplete="bday-year"
          maxLength={4}
          required
          className={`${inputClass} text-center`}
          onChange={(event) => take(event, 4)}
        />
      </div>
    </fieldset>
  );
}

/**
 * A method as a tile: TransFi's own mark on a white badge — the marks are drawn
 * for a light ground and some are dark — and the name beside it. The bank tile
 * stands for a list of banks, so it carries a generic mark instead.
 */
/** A provider mark on white — the marks are drawn for a light ground, and some are dark. */
function MethodLogo({ url, size }: { readonly url: string | null; readonly size: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-md bg-white p-1"
      style={{ width: size, height: size }}
    >
      {url === null ? (
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="size-full text-neutral-800"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 10 12 4l9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" />
        </svg>
      ) : (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-contain"
        />
      )}
    </span>
  );
}

function MethodTile({
  label,
  logoUrl,
  selected,
  onSelect,
}: {
  readonly label: string;
  readonly logoUrl?: string | null;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`flex min-h-16 items-center gap-3 rounded-xl border px-3.5 py-3 text-left text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        selected
          ? "border-ink bg-ink text-panel"
          : "border-line bg-panel text-ink enabled:hover:bg-field"
      }`}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white p-1.5">
        {logoUrl === undefined || logoUrl === null ? (
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="size-5 text-neutral-800"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 10 12 4l9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" />
          </svg>
        ) : (
          <img
            src={logoUrl}
            alt=""
            width="24"
            height="24"
            loading="lazy"
            decoding="async"
            className="size-full object-contain"
          />
        )}
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

function Field({
  id,
  name,
  label,
  type = "text",
  autoComplete,
  placeholder,
}: {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly type?: string;
  readonly autoComplete: string;
  readonly placeholder: string;
}) {
  return (
    <div>
      <label className={compactLabel} htmlFor={`${id}-${name}`}>
        {label}
      </label>
      <input
        id={`${id}-${name}`}
        name={name}
        type={type}
        required
        autoComplete={autoComplete}
        placeholder={placeholder}
        maxLength={200}
        className={inputClass}
      />
    </div>
  );
}
