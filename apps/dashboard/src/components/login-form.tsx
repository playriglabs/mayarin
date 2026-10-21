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
import { toast } from "sonner";
import { match, P } from "ts-pattern";
import { AuthCard } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";
import { CodeInput } from "@/components/ui/code-input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { ButtonLoader } from "@/components/ui/page-loader";
import { useLogin, useLoginMfa } from "@/hooks/auth";
import { ICON_NAV } from "@/lib/icons";
import { formatRetryAfter, loginFailureOf } from "@/lib/login-failure";
import { withQuery } from "@/lib/with-query";
import { isMfaChallenge } from "@/types/auth";

const MFA_CODE_LENGTH = 6;
const RECOVERY_CODE_LENGTH = 8;
const RECOVERY_GROUP_SIZE = 4;

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
  const loginMfa = useLoginMfa();
  /** Set once the password is accepted and a code is owed; no session exists yet. */
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  /** A recovery code is eight characters, so it gets its own boxes, not the six digit ones. */
  const [useRecovery, setUseRecovery] = useState(false);
  const submitting = login.isPending || loginMfa.isPending || state.status === "submitting";
  const blocked = state.status === "blocked";
  const remainingSeconds = blocked
    ? Math.max(0, Math.ceil((state.untilMs - currentMs) / 1_000))
    : 0;
  const remainingLabel = formatRetryAfter(remainingSeconds);
  const errorId =
    state.status === "error" || state.status === "unverified" || blocked
      ? "login-error"
      : undefined;

  // The code step lands here with `?verified=1`. Said once, then dropped from
  // the URL so a reload does not congratulate them again.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("verified") === "1") {
      toast.success("Email confirmed. Sign in to continue.");
      url.searchParams.delete("verified");
    } else if (url.searchParams.get("reset") === "1") {
      toast.success("Password changed. Sign in with the new one.");
      url.searchParams.delete("reset");
    } else return;
    window.history.replaceState(null, "", url);
  }, []);

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

  /**
   * Takes the code rather than reading state: `onComplete` fires inside the
   * same event as the last keystroke, where `code` still holds five digits.
   */
  function submitCode(submitted: string) {
    const value = submitted.trim();
    if (challenge === null || submitting) return;
    if (value.length !== (useRecovery ? RECOVERY_CODE_LENGTH : MFA_CODE_LENGTH)) return;
    setState({ status: "submitting" });
    loginMfa.mutate(
      { challenge, code: value },
      {
        onSuccess: () => {
          window.location.href = "/";
        },
        onError: (error) => {
          const failure = loginFailureOf(error);
          setCode("");
          setState({ status: "error", reason: failure.reason });
        },
      },
    );
  }

  function onSubmit(event: { preventDefault(): void }) {
    event.preventDefault();
    if (blocked) return;
    setState({ status: "submitting" });
    login.mutate(
      { email, password },
      {
        onSuccess: (response) => {
          if (isMfaChallenge(response)) {
            setChallenge(response.challenge);
            setState({ status: "idle" });
            return;
          }
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

  if (challenge !== null) {
    const codeError = state.status === "error";
    return (
      <AuthCard>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submitCode(code);
          }}
          className="flex w-full flex-col gap-4"
        >
          <div className="flex flex-col gap-3">
            <h1 className="text-2xl text-foreground">Two-factor authentication</h1>
            <p className="text-base text-muted-foreground">
              {useRecovery
                ? "Enter one of your recovery codes. Each works once."
                : `Enter the ${MFA_CODE_LENGTH}-digit code from your authenticator app for ${email}.`}
            </p>
          </div>

          <div className="mt-2 flex flex-col gap-3">
            <Field>
              <div className="mb-1 flex items-center justify-between gap-4">
                <FieldLabel id="login-mfa-label" htmlFor="login-mfa-code" className="text-sm">
                  {useRecovery ? "Recovery code" : "Authentication code"}
                </FieldLabel>
                <button
                  type="button"
                  className="cursor-pointer text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  onClick={() => {
                    setChallenge(null);
                    setCode("");
                    setUseRecovery(false);
                    setState({ status: "idle" });
                  }}
                >
                  Use a different account
                </button>
              </div>
              {useRecovery ? (
                <CodeInput
                  id="login-mfa-code"
                  value={code}
                  onChange={setCode}
                  length={RECOVERY_CODE_LENGTH}
                  groupSize={RECOVERY_GROUP_SIZE}
                  alphanumeric
                  disabled={submitting}
                  invalid={codeError}
                  labelledBy="login-mfa-label"
                  {...(codeError ? { describedBy: "login-error" } : {})}
                  onComplete={(next) => submitCode(next)}
                />
              ) : (
                <CodeInput
                  id="login-mfa-code"
                  value={code}
                  onChange={setCode}
                  length={MFA_CODE_LENGTH}
                  disabled={submitting}
                  invalid={codeError}
                  labelledBy="login-mfa-label"
                  {...(codeError ? { describedBy: "login-error" } : {})}
                  // A complete code needs no second action: the last digit submits.
                  onComplete={(next) => submitCode(next)}
                />
              )}
            </Field>
          </div>

          <div aria-live="polite" className="empty:hidden">
            {codeError ? (
              <p id="login-error" role="alert" className="text-xs text-destructive">
                {state.reason}
              </p>
            ) : null}
          </div>

          <Button
            type="submit"
            disabled={
              submitting || code.length !== (useRecovery ? RECOVERY_CODE_LENGTH : MFA_CODE_LENGTH)
            }
            className="mt-2 h-12 w-full rounded-full px-6 text-base"
          >
            {submitting ? <ButtonLoader label="Processing" /> : "Verify and sign in"}
          </Button>

          <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
            <button
              type="button"
              className="cursor-pointer underline underline-offset-2 hover:text-foreground"
              onClick={() => {
                setUseRecovery((previous) => !previous);
                setCode("");
                setState({ status: "idle" });
              }}
            >
              {useRecovery ? "Use your authenticator app" : "Use a recovery code instead"}
            </button>
          </div>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard>
      <form onSubmit={onSubmit} className="flex w-full flex-col gap-4">
        <div className="flex flex-col gap-3">
          <h1 className="text-2xl text-foreground">Sign in to your dashboard</h1>
          <p className="text-base text-muted-foreground">
            Manage payments, customers and settlement.
          </p>
        </div>

        <div className="flex flex-col gap-3 mt-2">
          <Field>
            <FieldLabel htmlFor="login-email" className="text-sm">
              Email
            </FieldLabel>
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
              className="h-12 px-4 text-base"
            />
          </Field>

          <Field>
            <div className="flex items-center justify-between">
              <FieldLabel htmlFor="login-password" className="text-sm">
                Password
              </FieldLabel>
              <a
                href="/forgot-password"
                className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                Forgot your password?
              </a>
            </div>
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
                className="first:pl-4 text-base"
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
                className="size-12 hover:bg-transparent"
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
          className="h-12 w-full rounded-full px-6 text-base"
        >
          {submitting ? (
            <ButtonLoader label="Processing" />
          ) : blocked ? (
            `Try again in ${remainingLabel}`
          ) : (
            "Continue"
          )}
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          New to Mayarin?{" "}
          <a href="/register" className="underline underline-offset-2 hover:text-foreground">
            Create an account
          </a>
        </p>
      </form>
    </AuthCard>
  );
}

export default withQuery(LoginForm);
