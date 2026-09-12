/**
 * Registration form — a React island, shaped like the login form beside it.
 *
 * Three fields and nothing else. A settlement address is the one thing a
 * merchant cannot safely paste before they are inside: it decides where their
 * money lands, it has no meaning until they have picked a network, and getting
 * it wrong on a signup form is unrecoverable. Settings asks for it instead, and
 * the domain already treats it as optional.
 *
 * On success the API says nothing about whether the address was already taken,
 * so this form cannot either — it always moves to the code step, which is also
 * the recovery path for somebody who abandoned a signup halfway.
 */

import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { match, P } from "ts-pattern";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { useRegister } from "@/hooks/auth";
import { ICON_NAV } from "@/lib/icons";
import { formatRetryAfter, loginFailureOf } from "@/lib/login-failure";
import { withQuery } from "@/lib/with-query";

/** Mirrors the API's floor. Stated up front rather than only on rejection. */
const MIN_PASSWORD_LENGTH = 12;

type FormState =
  | { readonly status: "idle" }
  | { readonly status: "submitting" }
  | { readonly status: "error"; readonly reason: string };

function RegisterForm() {
  const [state, setState] = useState<FormState>({ status: "idle" });
  const [merchantName, setMerchantName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [revealed, setRevealed] = useState(false);
  const register = useRegister();
  const submitting = register.isPending || state.status === "submitting";
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const errorId = state.status === "error" ? "register-error" : undefined;

  function onSubmit(event: { preventDefault(): void }) {
    event.preventDefault();
    if (tooShort) return;
    setState({ status: "submitting" });
    register.mutate(
      { email, password, merchantName },
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

  return (
    <form
      onSubmit={onSubmit}
      className="flex w-full max-w-md flex-col gap-4 p-6 max-md:bg-background"
    >
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-medium text-foreground">Create your merchant account</h1>
        <p className="text-sm text-muted-foreground">
          Price in your own currency, settle in a stablecoin.
        </p>
      </div>

      <div className="mt-2 flex flex-col gap-3">
        <Field>
          <FieldLabel htmlFor="register-merchant">Business name</FieldLabel>
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
            className="h-12 px-4"
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="register-email">Email</FieldLabel>
          <Input
            id="register-email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
            aria-describedby={errorId}
            className="h-12 px-4"
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="register-password">Password</FieldLabel>
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
              disabled={submitting}
              aria-describedby={errorId ?? (tooShort ? "register-password-hint" : undefined)}
              className="first:pl-4"
            />
            <InputGroupButton
              onClick={() => setRevealed((previous) => !previous)}
              disabled={submitting}
              aria-label={revealed ? "Hide password" : "Show password"}
              aria-pressed={revealed}
              aria-controls="register-password"
              className="size-12"
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

      <Button
        type="submit"
        disabled={submitting || tooShort}
        className="login-submit h-12 w-full px-6 text-xl"
      >
        {submitting ? "Processing.." : "Create account"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <a href="/login" className="underline underline-offset-2 hover:text-foreground">
          Sign in
        </a>
      </p>
    </form>
  );
}

export default withQuery(RegisterForm);
