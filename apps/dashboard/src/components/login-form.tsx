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
import { useEffect, useState } from "react";
import { match, P } from "ts-pattern";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { useLogin } from "@/hooks/auth";
import { ICON_NAV } from "@/lib/icons";
import { formatRetryAfter, loginFailureOf } from "@/lib/login-failure";
import { withQuery } from "@/lib/with-query";

type FormState =
  | { readonly status: "idle" }
  | { readonly status: "submitting" }
  | { readonly status: "error"; readonly reason: string }
  /** Credentials were right, the address was never confirmed. */
  | { readonly status: "unverified"; readonly reason: string }
  | { readonly status: "blocked"; readonly reason: string; readonly untilMs: number };

function LoginForm() {
  const [state, setState] = useState<FormState>({ status: "idle" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const login = useLogin();
  const submitting = login.isPending || state.status === "submitting";
  const blocked = state.status === "blocked";
  const remainingSeconds = blocked
    ? Math.max(0, Math.ceil((state.untilMs - currentMs) / 1_000))
    : 0;
  const remainingLabel = formatRetryAfter(remainingSeconds);
  const errorId =
    state.status === "error" || state.status === "unverified" || blocked
      ? "login-error"
      : undefined;

  useEffect(() => {
    if (state.status !== "blocked") return;

    const update = () => {
      const nowMs = Date.now();
      setCurrentMs(nowMs);
      if (nowMs >= state.untilMs) setState({ status: "idle" });
    };
    update();
    const interval = window.setInterval(update, 1_000);
    return () => window.clearInterval(interval);
  }, [state]);

  function onSubmit(event: { preventDefault(): void }) {
    event.preventDefault();
    if (blocked) return;
    setState({ status: "submitting" });
    login.mutate(
      { email, password },
      {
        onSuccess: () => {
          window.location.href = "/";
        },
        onError: (error) => {
          const failure = loginFailureOf(error);
          match(failure)
            .with({ type: "error" }, ({ reason }) => setState({ status: "error", reason }))
            .with({ type: "unverified" }, ({ reason }) =>
              setState({ status: "unverified", reason }),
            )
            .with({ type: "blocked" }, ({ reason, retryAfterSeconds }) => {
              const nowMs = Date.now();
              setCurrentMs(nowMs);
              setState({
                status: "blocked",
                reason,
                untilMs: nowMs + retryAfterSeconds * 1_000,
              });
            })
            .exhaustive();
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
          .with({ status: "unverified" }, (s) => (
            <div id="login-error" role="alert" className="text-xs text-destructive">
              <p>{s.reason}</p>
              <a
                href={`/verify?email=${encodeURIComponent(email)}`}
                className="underline underline-offset-2"
              >
                Enter your code
              </a>
            </div>
          ))
          .with({ status: "blocked" }, (s) => (
            <div id="login-error" role="alert" className="text-xs text-destructive">
              <p>{s.reason}</p>
              <p>Try again in {remainingLabel}.</p>
            </div>
          ))
          .exhaustive()}
      </div>

      <Button
        type="submit"
        disabled={submitting || blocked}
        className="login-submit h-12 w-full px-6 text-xl"
      >
        {submitting ? "Processing.." : blocked ? `Try again in ${remainingLabel}` : "Continue"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        New to Mayarin?{" "}
        <a href="/register" className="underline underline-offset-2 hover:text-foreground">
          Create an account
        </a>
      </p>
    </form>
  );
}

export default withQuery(LoginForm);
