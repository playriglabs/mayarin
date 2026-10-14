/**
 * Registration form — a React island, shaped like the login form beside it.
 *
 * Business details and account credentials. A settlement address is the one thing a
 * merchant cannot safely paste before they are inside: it decides where their
 * money lands, it has no meaning until they have picked a network, and getting
 * it wrong on a signup form is unrecoverable. Settings asks for it instead, and
 * the domain already treats it as optional.
 *
 * Two steps on the client, one request to the API: the account (email and
 * password) on the narrow card, then the business on the wide setup frame.
 * Nothing is sent until the second step, so going back loses nothing.
 *
 * On success the API says nothing about whether the address was already taken,
 * so this form cannot either — it always moves to the code step, which is also
 * the recovery path for somebody who abandoned a signup halfway.
 */

import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { match, P } from "ts-pattern";
import { AuthCard, AuthSetup } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  type ComboboxOption,
} from "@/components/ui/combobox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { ButtonLoader } from "@/components/ui/page-loader";
import { useRegister } from "@/hooks/auth";
import { COUNTRIES } from "@/lib/countries";
import { ICON_NAV } from "@/lib/icons";
import { localRailsFor } from "@/lib/local-rails";
import { formatRetryAfter, loginFailureOf } from "@/lib/login-failure";
import { withQuery } from "@/lib/with-query";

/** Mirrors the API's floor. Stated up front rather than only on rejection. */
const MIN_PASSWORD_LENGTH = 12;

const COUNTRY_OPTIONS = [...COUNTRIES]
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((country) => ({
    value: country.code,
    label: `${String.fromCodePoint(...Array.from(country.code, (letter) => 0x1f1e6 + letter.charCodeAt(0) - 65))} ${country.name} (${country.code})`,
  }));

type Step = "account" | "business";

type FormState =
  | { readonly status: "idle" }
  | { readonly status: "submitting" }
  | { readonly status: "error"; readonly reason: string };

function RegisterForm() {
  const [step, setStep] = useState<Step>("account");
  const [state, setState] = useState<FormState>({ status: "idle" });
  const [merchantName, setMerchantName] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [city, setCity] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [revealed, setRevealed] = useState(false);
  const register = useRegister();
  const submitting = register.isPending || state.status === "submitting";
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const errorId = state.status === "error" ? "register-error" : undefined;
  const rails = localRailsFor(countryCode);
  const countryName = COUNTRIES.find((country) => country.code === countryCode)?.name;

  function onSubmit(event: { preventDefault(): void }) {
    event.preventDefault();
    if (tooShort || countryCode === "") return;
    setState({ status: "submitting" });
    register.mutate(
      { email, password, merchantName, countryCode, city: city.trim() },
      {
        // The address travels in the URL so the code step can address the
        // person by the inbox they are about to open, without a second typing.
        onSuccess: () => {
          window.location.href = `/verify?email=${encodeURIComponent(email)}`;
        },
        onError: (error) => {
          const failure = loginFailureOf(error);
          const reason = match(failure)
            .with({ type: "error" }, ({ reason: message }) => message)
            // Unreachable here — nothing on this form signs in — but the union
            // is shared with the login form and the compiler is right to insist.
            .with({ type: "unverified" }, ({ reason: message }) => message)
            .with(
              { type: "blocked" },
              ({ retryAfterSeconds }) =>
                `Too many attempts. Try again in ${formatRetryAfter(retryAfterSeconds)}.`,
            )
            .exhaustive();
          setState({ status: "error", reason });
        },
      },
    );
  }

  function onContinue(event: { preventDefault(): void }) {
    event.preventDefault();
    if (tooShort) return;
    setStep("business");
  }

  if (step === "account") {
    return (
      <AuthCard>
        <form onSubmit={onContinue} className="flex w-full flex-col gap-4">
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">Step 1 of 2</p>
            <h1 className="text-2xl text-foreground">Create your testnet account</h1>
            <p className="text-base text-muted-foreground">
              This is a testing environment. Transactions use test assets and have no real-world
              value.
            </p>
          </div>

          <div className="mt-2 flex flex-col gap-3">
            <Field>
              <FieldLabel htmlFor="register-email" className="text-sm">
                Email
              </FieldLabel>
              <Input
                id="register-email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-12 px-4 text-base"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="register-password" className="text-sm">
                Password
              </FieldLabel>
              <InputGroup className="h-12">
                <InputGroupInput
                  id="register-password"
                  type={revealed ? "text" : "password"}
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  autoComplete="new-password"
                  placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-describedby={tooShort ? "register-password-hint" : undefined}
                  className="first:pl-4 text-base"
                />
                <InputGroupButton
                  onClick={() => setRevealed((previous) => !previous)}
                  aria-label={revealed ? "Hide password" : "Show password"}
                  aria-pressed={revealed}
                  aria-controls="register-password"
                  className="size-12 hover:bg-transparent"
                >
                  {revealed ? (
                    <EyeSlashIcon size={ICON_NAV} aria-hidden="true" />
                  ) : (
                    <EyeIcon size={ICON_NAV} aria-hidden="true" />
                  )}
                </InputGroupButton>
              </InputGroup>
              {tooShort && (
                <p id="register-password-hint" className="text-xs text-muted-foreground">
                  {MIN_PASSWORD_LENGTH} characters or more. Length beats punctuation.
                </p>
              )}
            </Field>
          </div>

          <Button
            type="submit"
            disabled={tooShort}
            className="login-submit h-12 w-full rounded-full px-6 text-base"
          >
            Continue
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <a href="/login" className="underline underline-offset-2 hover:text-foreground">
              Sign in
            </a>
          </p>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthSetup
      aside={
        <span>
          Signing up as <span className="text-foreground">{email}</span>
        </span>
      }
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setStep("account")}
            disabled={submitting}
            className="h-11 rounded-full px-5 text-base"
          >
            Back
          </Button>
          <Button
            type="submit"
            form="register-business"
            disabled={submitting || countryCode === ""}
            className="login-submit h-11 rounded-full px-5 text-base"
          >
            {submitting ? <ButtonLoader label="Processing" /> : "Create account"}
          </Button>
        </>
      }
    >
      <form id="register-business" onSubmit={onSubmit} className="flex w-full flex-col gap-4">
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">Step 2 of 2</p>
          <h1 className="text-2xl text-foreground">Tell us about your business</h1>
          <p className="text-base text-muted-foreground">
            Price in your own currency, settle in a stablecoin.
          </p>
        </div>

        <div className="mt-4 flex flex-col gap-5">
          <Field>
            <FieldLabel htmlFor="register-merchant" className="text-sm">
              Business name
            </FieldLabel>
            <Input
              id="register-merchant"
              required
              maxLength={120}
              autoComplete="organization"
              placeholder="Your Company"
              value={merchantName}
              onChange={(e) => setMerchantName(e.target.value)}
              disabled={submitting}
              aria-describedby={errorId}
              className="h-12 px-4 text-base"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="register-country" className="text-sm">
              Country
            </FieldLabel>
            <Combobox
              items={COUNTRY_OPTIONS}
              name="countryCode"
              value={countryCode}
              onValueChange={setCountryCode}
              disabled={submitting}
            >
              <ComboboxInput
                id="register-country"
                required
                placeholder="Search country or code"
                aria-describedby={errorId}
                className="h-12 pl-4 text-base"
              />
              <ComboboxContent align="start" className="max-h-80 w-(--anchor-width)">
                <ComboboxEmpty className="text-base">No countries found.</ComboboxEmpty>
                <ComboboxList>
                  {(country: ComboboxOption) => (
                    <ComboboxItem key={country.value} value={country} className="py-2.5 text-base">
                      {country.label}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </Field>

          {rails.length > 0 && (
            <p
              role="status"
              className="rounded-xl border border-border px-4 py-3 text-sm text-muted-foreground"
            >
              Payers in {countryName} can also pay in local currency with {rails.join(", ")}. You
              still receive a stablecoin.
            </p>
          )}

          <Field>
            <FieldLabel htmlFor="register-city" className="text-sm">
              City
            </FieldLabel>
            <Input
              id="register-city"
              name="city"
              required
              maxLength={120}
              autoComplete="address-level2"
              placeholder="Your city"
              value={city}
              onChange={(event) => setCity(event.target.value)}
              disabled={submitting}
              aria-describedby={errorId}
              className="h-12 px-4 text-base"
            />
          </Field>
        </div>

        <div aria-live="polite" className="empty:hidden">
          {match(state)
            .with(P.union({ status: "idle" }, { status: "submitting" }), () => null)
            .with({ status: "error" }, (s) => (
              <p id="register-error" role="alert" className="text-xs text-destructive">
                {s.reason}
              </p>
            ))
            .exhaustive()}
        </div>
      </form>
    </AuthSetup>
  );
}

export default withQuery(RegisterForm);
