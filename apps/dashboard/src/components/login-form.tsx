/**
 * Login form — a React island.
 *
 * State is a discriminated union (`idle | submitting | error`) matched with
 * `ts-pattern`'s `.exhaustive()`. The submit runs `authApi.login` as a React
 * Query mutation; a success redirects to the dashboard, a failure maps the
 * typed `ApiError` to a human reason. `withQuery` mounts this component below
 * the shared `QueryClientProvider` so SSR resolves the context.
 */

import { useState } from "react";
import { match } from "ts-pattern";
import { useLogin } from "@/hooks/auth";
import { ApiError } from "@/lib/api/client";
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
  const login = useLogin();
  const submitting = login.isPending || state.status === "submitting";

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
      className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-stone-200 bg-white p-6 shadow-sm"
    >
      <h1 className="text-xl font-semibold text-stone-800">Mayarin Dashboard</h1>
      <p className="text-sm text-stone-500">Sign in to manage payments.</p>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-stone-600">Email</span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting}
          className="rounded border border-stone-300 px-3 py-2 disabled:opacity-60"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-stone-600">Password</span>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={submitting}
          className="rounded border border-stone-300 px-3 py-2 disabled:opacity-60"
        />
      </label>

      {match(state)
        .with({ status: "idle" }, () => null)
        .with({ status: "submitting" }, () => <p className="text-sm text-stone-500">Signing in…</p>)
        .with({ status: "error" }, (s) => <p className="text-sm text-red-600">{s.reason}</p>)
        .exhaustive()}

      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-stone-800 px-4 py-2 font-medium text-white disabled:opacity-60"
      >
        Sign in
      </button>
    </form>
  );
}

export default withQuery(LoginForm);
