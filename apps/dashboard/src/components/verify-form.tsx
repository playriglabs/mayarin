/**
 * Email verification — the second half of registration.
 *
 * The address arrives in the query string from the register form, and is
 * editable here: somebody who mistyped it on the first screen would otherwise
 * be stuck asking an inbox they do not own for a code.
 *
 * A code that is wrong, expired, or already superseded all answer the same way,
 * which is deliberate on the API side — so the recovery this form offers is
 * always the same too: ask for a new one.
 */

import { useState } from "react";
import { match, P } from "ts-pattern";
import { Button } from "@/components/ui/button";
import { CodeInput } from "@/components/ui/code-input";
import { Field, FieldLabel } from "@/components/ui/field";
import { useResendVerification, useVerifyEmail } from "@/hooks/auth";
import { formatRetryAfter, loginFailureOf } from "@/lib/login-failure";
import { withQuery } from "@/lib/with-query";

const CODE_LENGTH = 6;

/** Mirrors the API's own window. Said out loud so the reader knows how long they have. */
const CODE_TTL_MINUTES = 15;

type FormState =
  | { readonly status: "idle" }
  | { readonly status: "submitting" }
  | { readonly status: "sent" }
  | { readonly status: "error"; readonly reason: string };

/** The address the register step forwarded, if it forwarded one. */
function emailFromUrl(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("email") ?? "";
}

function VerifyForm() {
  const [state, setState] = useState<FormState>({ status: "idle" });
  // Read once, never edited. The code was sent to exactly one address, so an
  // editable field here offers a change that cannot work — and a person who
  // mistyped their address on the way in needs to register again, not retype it
  // on top of a code issued for somebody else's inbox.
  const [email] = useState(emailFromUrl);
  const [code, setCode] = useState("");
  const verify = useVerifyEmail();
  const resend = useResendVerification();
  const submitting = verify.isPending || state.status === "submitting";
  const errorId = state.status === "error" ? "verify-error" : undefined;

  function failureReason(error: unknown): string {
    const failure = loginFailureOf(error);
    return (
      match(failure)
        .with({ type: "error" }, ({ reason }) => reason)
        // Unreachable here — nothing on this form signs in — but the union is
        // shared with the login form and the compiler is right to insist.
        .with({ type: "unverified" }, ({ reason }) => reason)
        .with(
          { type: "blocked" },
          ({ retryAfterSeconds }) =>
            `Too many attempts. Try again in ${formatRetryAfter(retryAfterSeconds)}.`,
        )
        .exhaustive()
    );
  }

  /**
   * Takes the code rather than reading state: `onComplete` fires inside the
   * same event as the last keystroke, where `code` still holds five digits.
   */
  function submit(submitted: string) {
    // Guarded because the button and the last keystroke can both reach here:
    // a paste completes the code and the reader presses Confirm anyway.
    if (submitting || submitted.length !== CODE_LENGTH) return;
    setState({ status: "submitting" });
    verify.mutate(
      { email, code: submitted },
      {
        onSuccess: () => {
          window.location.href = "/login?verified=1";
        },
        onError: (error) => setState({ status: "error", reason: failureReason(error) }),
      },
    );
  }

  function onSubmit(event: { preventDefault(): void }) {
    event.preventDefault();
    submit(code);
  }

  function onResend() {
    setState({ status: "submitting" });
    resend.mutate(
      { email },
      {
        // The old code stops working the moment this succeeds, so the field is
        // cleared rather than left holding something that can no longer work.
        onSuccess: () => {
          setCode("");
          setState({ status: "sent" });
        },
        onError: (error) => setState({ status: "error", reason: failureReason(error) }),
      },
    );
  }

  // Opened directly, with no address to verify against. There is no code to
  // enter and nothing to resend, so the only honest thing on this page is the
  // way back.
  if (email === "") {
    return (
      <div className="flex w-full max-w-md flex-col gap-4 p-6 max-md:bg-background">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-medium text-foreground">Confirm your email</h1>
          <p className="text-sm text-muted-foreground">
            This link is missing the address it belongs to. Start again and we will send a new code.
          </p>
        </div>
        <a
          href="/register"
          className="login-submit inline-flex h-12 items-center justify-center rounded-lg bg-primary px-6 text-xl text-primary-foreground"
        >
          Create an account
        </a>
        <p className="text-center text-sm text-muted-foreground">
          Already confirmed?{" "}
          <a href="/login" className="underline underline-offset-2 hover:text-foreground">
            Sign in
          </a>
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex w-full max-w-md flex-col gap-4 p-6 max-md:bg-background"
    >
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-medium text-foreground">Confirm your email</h1>
        <p className="text-sm text-muted-foreground">
          We sent a {CODE_LENGTH}-digit code to{" "}
          <span className="font-medium text-foreground">{email}</span>. It expires in{" "}
          {CODE_TTL_MINUTES} minutes.
        </p>
      </div>

      <div className="mt-2 flex flex-col gap-3">
        <Field>
          <FieldLabel id="verify-code-label" htmlFor="verify-code" className="mb-1 text-sm">
            Verification code
          </FieldLabel>
          <CodeInput
            id="verify-code"
            value={code}
            onChange={setCode}
            length={CODE_LENGTH}
            disabled={submitting}
            invalid={state.status === "error"}
            labelledBy="verify-code-label"
            {...(errorId === undefined ? {} : { describedBy: errorId })}
            // A complete code needs no second action: the last digit submits.
            onComplete={(next) => submit(next)}
          />
        </Field>
      </div>

      <div aria-live="polite" className="empty:hidden">
        {match(state)
          .with(P.union({ status: "idle" }, { status: "submitting" }), () => null)
          .with({ status: "sent" }, () => (
            <p className="text-xs text-muted-foreground">
              A new code is on its way. The previous one no longer works.
            </p>
          ))
          .with({ status: "error" }, (s) => (
            <p id="verify-error" role="alert" className="text-xs text-destructive">
              {s.reason}
            </p>
          ))
          .exhaustive()}
      </div>

      <Button
        type="submit"
        disabled={submitting || code.length !== CODE_LENGTH}
        className="login-submit h-12 w-full mt-2 px-6 text-xl"
      >
        {submitting ? "Processing.." : "Confirm email"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Did not get it?{" "}
        <button
          type="button"
          onClick={onResend}
          disabled={submitting || resend.isPending}
          className="underline underline-offset-2 cursor-pointer hover:text-foreground disabled:opacity-50"
        >
          Send a new code
        </button>
      </p>
    </form>
  );
}

export default withQuery(VerifyForm);
