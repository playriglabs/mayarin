/**
 * Password reset, in two steps on one screen: ask for a code, then redeem it.
 *
 * The first step says the same thing whether or not the address has an account,
 * because the API does. The second asks for the authenticator code only when
 * the account owes one; the API answers `mfa_code_required` and the field
 * appears, so a visitor learns nothing about the account before the email code
 * has been proven.
 */

import { useState } from "react";
import { AuthCard } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ButtonLoader } from "@/components/ui/page-loader";
import { useForgotPassword, useResetPassword } from "@/hooks/auth";
import { ApiError } from "@/lib/api/client";
import { withQuery } from "@/lib/with-query";

function reasonOf(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Try again.";
}

function ForgotPasswordForm() {
  const forgot = useForgotPassword();
  const reset = useResetPassword();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [needsMfa, setNeedsMfa] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function requestCode(event: { preventDefault(): void }) {
    event.preventDefault();
    setError(null);
    forgot.mutate(
      { email },
      { onSuccess: () => setSent(true), onError: (failure) => setError(reasonOf(failure)) },
    );
  }

  function submit(event: { preventDefault(): void }) {
    event.preventDefault();
    setError(null);
    reset.mutate(
      { email, code, newPassword, ...(mfaCode === "" ? {} : { mfaCode }) },
      {
        onSuccess: () => {
          window.location.href = "/login?reset=1";
        },
        onError: (failure) => {
          if (failure instanceof ApiError && failure.message.includes("authenticator")) {
            setNeedsMfa(true);
          }
          setError(reasonOf(failure));
        },
      },
    );
  }

  return (
    <AuthCard>
      <div className="flex w-full flex-col gap-4">
        <div className="flex flex-col gap-3">
          <h1 className="text-2xl text-foreground">Reset your password</h1>
          <p className="text-base text-muted-foreground">
            {sent
              ? `If ${email} has an account, a 6-digit code is on its way. It expires in 15 minutes.`
              : "Enter your email and we will send a code to choose a new password."}
          </p>
        </div>

        {sent ? (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <Field>
              <FieldLabel htmlFor="reset-code" className="text-sm">
                Code from your email
              </FieldLabel>
              <Input
                id="reset-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="h-12 px-4 text-base"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="reset-password" className="text-sm">
                New password (12 characters or more)
              </FieldLabel>
              <Input
                id="reset-password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="h-12 px-4 text-base"
              />
            </Field>
            {needsMfa ? (
              <Field>
                <FieldLabel htmlFor="reset-mfa" className="text-sm">
                  Authenticator or recovery code
                </FieldLabel>
                <Input
                  id="reset-mfa"
                  autoComplete="one-time-code"
                  required
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  className="h-12 px-4 text-base"
                />
              </Field>
            ) : null}
            {error === null ? null : (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
            <Button
              type="submit"
              disabled={reset.isPending}
              className="h-12 rounded-full text-base"
            >
              {reset.isPending ? <ButtonLoader label="Processing" /> : "Set new password"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Did not get it?{" "}
              <button
                type="button"
                onClick={() => setSent(false)}
                className="underline underline-offset-2 cursor-pointer hover:text-foreground"
              >
                Send a new code
              </button>
            </p>
          </form>
        ) : (
          <form onSubmit={requestCode} className="flex flex-col gap-3">
            <Field>
              <FieldLabel htmlFor="forgot-email" className="text-sm">
                Email
              </FieldLabel>
              <Input
                id="forgot-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-12 px-4 text-base"
              />
            </Field>
            {error === null ? null : (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
            <Button
              type="submit"
              disabled={forgot.isPending}
              className="h-12 rounded-full text-base"
            >
              {forgot.isPending ? <ButtonLoader label="Processing" /> : "Send code"}
            </Button>
          </form>
        )}

        <p className="text-center text-sm text-muted-foreground">
          <a href="/login" className="underline underline-offset-2 hover:text-foreground">
            Back to sign in
          </a>
        </p>
      </div>
    </AuthCard>
  );
}

export default withQuery(ForgotPasswordForm);
