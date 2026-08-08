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
import { match } from "ts-pattern";
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
    <form
      onSubmit={onSubmit}
      className="flex w-full max-w-sm flex-col gap-5 border border-border bg-card p-4"
    >
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-medium text-foreground">
          <span aria-hidden="true" className="inline-block size-1.5 bg-brand" />
          Mayarin
        </h1>
        <p className="text-sm text-muted-foreground">Sign in to manage payments.</p>
      </div>

      <div className="flex flex-col gap-3">
        <Field>
          <FieldLabel htmlFor="login-email">Email</FieldLabel>
          <Input
            id="login-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
            aria-describedby={errorId}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="login-password">Password</FieldLabel>
          <InputGroup>
            <InputGroupInput
              id="login-password"
              // Swapping `type` is what actually reveals the value. The field
              // keeps its `autoComplete` either way, so a password manager
              // still recognises it while revealed.
              type={revealed ? "text" : "password"}
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              aria-describedby={errorId}
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
          .with({ status: "idle" }, () => null)
          .with({ status: "submitting" }, () => (
            <p className="text-xs text-subtle-foreground">Signing in…</p>
          ))
          .with({ status: "error" }, (s) => (
            <p id="login-error" role="alert" className="text-xs text-destructive">
              {s.reason}
            </p>
          ))
          .exhaustive()}
      </div>

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

export default withQuery(LoginForm);
