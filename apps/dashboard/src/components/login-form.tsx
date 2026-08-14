/**
 * Login form — a React island.
 *
 * State is a discriminated union (`idle | submitting | error`) matched with
 * `ts-pattern`'s `.exhaustive()`. The submit runs `authApi.login` as a React
 * Query mutation; a success redirects to the dashboard, a failure maps the
 * typed `ApiError` to a human reason. `withQuery` mounts this component below
 * the shared `QueryClientProvider` so SSR resolves the context.
 *
 * The error is announced through `role="alert"` and bound to both inputs with
 * `aria-describedby`, so a failed sign-in reaches a screen reader without the
 * user hunting for it.
 */

import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { match, P } from "ts-pattern";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { useLogin } from "@/hooks/auth";
import { ApiError } from "@/lib/api/client";
import { ICON_NAV } from "@/lib/icons";
import { withQuery } from "@/lib/with-query";

type FormState =
  | { readonly status: "idle" }
  | { readonly status: "submitting" }
  | { readonly status: "error"; readonly reason: string };

function reasonOf(error: unknown): string {
  return match(error)
    .when(
      (e): e is ApiError => e instanceof ApiError && e.status === 401,
      () => "Invalid email or password",
    )
    .when(
      (e): e is ApiError => e instanceof ApiError,
      (e) => e.message,
    )
    .otherwise(() => "Login failed");
}

function LoginForm() {
  const [state, setState] = useState<FormState>({ status: "idle" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [revealed, setRevealed] = useState(false);
  const login = useLogin();
  const submitting = login.isPending || state.status === "submitting";
  const errorId = state.status === "error" ? "login-error" : undefined;

  function onSubmit(event: { preventDefault(): void }) {
    event.preventDefault();
    setState({ status: "submitting" });
    login.mutate(
      { email, password },
      {
        onSuccess: () => {
          window.location.href = "/";
        },
        onError: (error) => {
          setState({ status: "error", reason: reasonOf(error) });
        },
      },
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-md flex-col gap-4 bg-card p-6 sm:p-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-medium text-foreground">Sign in to your dashboard</h1>
        <p className="text-sm text-muted-foreground">Manage payments, customers and settlement.</p>
      </div>

      <div className="flex flex-col gap-3 mt-2">
        <Field>
          <FieldLabel htmlFor="login-email">Email</FieldLabel>
          <Input
            id="login-email"
            type="email"
            placeholder="you@company.com"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
            aria-describedby={errorId}
            className="h-12 px-4"
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="login-password">Password</FieldLabel>
          <InputGroup className="h-12">
            <InputGroupInput
              id="login-password"
              // Swapping `type` is what actually reveals the value. The field
              // keeps its `autoComplete` either way, so a password manager
              // still recognises it while revealed.
              type={revealed ? "text" : "password"}
              placeholder="Enter your password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              aria-describedby={errorId}
              className="first:pl-4"
            />
            <InputGroupButton
              onClick={() => setRevealed((previous) => !previous)}
              disabled={submitting}
              // The label states the ACTION the press performs; `aria-pressed`
              // carries the current state. Together a screen reader announces
              // both what pressing does and whether it is already on.
              aria-label={revealed ? "Hide password" : "Show password"}
              aria-pressed={revealed}
              aria-controls="login-password"
              className="size-12"
            >
              {revealed ? (
                <EyeSlashIcon size={ICON_NAV} aria-hidden="true" />
              ) : (
                <EyeIcon size={ICON_NAV} aria-hidden="true" />
              )}
            </InputGroupButton>
          </InputGroup>
        </Field>
      </div>

      <div aria-live="polite" className="empty:hidden">
        {match(state)
          .with(P.union({ status: "idle" }, { status: "submitting" }), () => null)
          .with({ status: "error" }, (s) => (
            <p id="login-error" role="alert" className="text-xs text-destructive">
              {s.reason}
            </p>
          ))
          .exhaustive()}
      </div>

      <Button type="submit" disabled={submitting} className="login-submit h-12 w-full px-6 text-xl">
        {submitting ? "Processing.." : "Continue"}
      </Button>
    </form>
  );
}

export default withQuery(LoginForm);
