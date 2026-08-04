/**
 * Create-user form — a React island that grants a sub-account in the caller's
 * own merchant.
 *
 * State is a discriminated union (`idle | submitting | error | created`)
 * matched with `ts-pattern`'s `.exhaustive()`. The submit runs `adminApi.createUser`
 * as a React Query mutation (the centralized client auto-attaches the CSRF
 * token); on success it invalidates the shared `["admin","users"]` query so the
 * sibling `UsersTable` refreshes, and surfaces a generated password once when
 * the server minted one. `withQuery` mounts this component below the shared
 * `QueryClientProvider`.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { match } from "ts-pattern";
import { useCreateUser } from "@/hooks/admin";
import { ApiError } from "@/lib/api/client";
import { withQuery } from "@/lib/with-query";
import { PERMISSION_LIST, type Permission } from "@/types/user";

const PERMISSION_LABELS: Readonly<Record<Permission, string>> = {
  "payments:read": "View payments",
  "users:manage": "Manage users",
  "admin:access": "Admin dashboard",
} as const;

type FormState =
  | { readonly status: "idle" }
  | { readonly status: "submitting" }
  | { readonly status: "error"; readonly reason: string }
  | { readonly status: "created"; readonly generatedPassword?: string };

function reasonOf(error: unknown): string {
  return match(error)
    .when(
      (e): e is ApiError => e instanceof ApiError && e.status === 403,
      () => "You need the users:manage permission to create accounts.",
    )
    .when(
      (e): e is ApiError => e instanceof ApiError && e.status === 409,
      () => "That email is already in use.",
    )
    .when(
      (e): e is ApiError => e instanceof ApiError,
      (e) => e.message,
    )
    .otherwise(() => "Failed to create account");
}

function CreateUserForm() {
  const queryClient = useQueryClient();
  const create = useCreateUser();
  const [state, setState] = useState<FormState>({ status: "idle" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [perms, setPerms] = useState<Set<Permission>>(new Set<Permission>(["payments:read"]));

  const submitting = create.isPending || state.status === "submitting";
  const passwordInvalid = password.length > 0 && password.length < 12;
  const canSubmit = email.trim() !== "" && perms.size > 0 && !passwordInvalid && !submitting;

  function togglePerm(p: Permission) {
    setPerms((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  function onSubmit(event: { preventDefault(): void }) {
    event.preventDefault();
    if (passwordInvalid) return;
    setState({ status: "submitting" });
    create.mutate(
      {
        email: email.trim(),
        permissions: [...perms],
        ...(password === "" ? {} : { password }),
      },
      {
        onSuccess: (res) => {
          setState({
            status: "created",
            ...(res.generatedPassword === undefined
              ? {}
              : { generatedPassword: res.generatedPassword }),
          });
          setEmail("");
          setPassword("");
          void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
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
      className="flex w-full max-w-md flex-col gap-4 rounded-lg border border-stone-200 bg-white p-6 shadow-sm"
    >
      <div>
        <h2 className="text-lg font-semibold text-stone-800">Grant an account</h2>
        <p className="text-sm text-stone-500">New accounts are scoped to this merchant only.</p>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-stone-600">Email</span>
        <input
          type="email"
          required
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting}
          className="rounded border border-stone-300 px-3 py-2 disabled:opacity-60"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-stone-600">Password (optional)</span>
        <input
          type="text"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={submitting}
          className="rounded border border-stone-300 px-3 py-2 font-mono text-xs disabled:opacity-60"
        />
        <span className="text-xs text-stone-400">
          Leave blank to auto-generate a strong password. If set, at least 12 characters.
        </span>
        {passwordInvalid && (
          <span className="text-xs text-red-600">Password must be at least 12 characters.</span>
        )}
      </label>

      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="font-medium text-stone-600">Permissions</legend>
        {PERMISSION_LIST.map((p) => (
          <label key={p} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={perms.has(p)}
              onChange={() => togglePerm(p)}
              disabled={submitting}
              className="h-4 w-4"
            />
            <span className="text-stone-700">{PERMISSION_LABELS[p]}</span>
          </label>
        ))}
      </fieldset>

      {match(state)
        .with({ status: "idle" }, () => null)
        .with({ status: "submitting" }, () => (
          <p className="text-sm text-stone-500">Creating account…</p>
        ))
        .with({ status: "error" }, (s) => <p className="text-sm text-red-600">{s.reason}</p>)
        .with({ status: "created" }, (s) => (
          <div className="rounded border border-green-200 bg-green-50 p-3 text-sm">
            <p className="font-medium text-green-800">Account created.</p>
            {s.generatedPassword !== undefined ? (
              <p className="mt-1 text-green-700">
                Generated password (store it now):{" "}
                <code className="font-mono">{s.generatedPassword}</code>
              </p>
            ) : (
              <p className="mt-1 text-green-700">The supplied password is active.</p>
            )}
          </div>
        ))
        .exhaustive()}

      <button
        type="submit"
        disabled={!canSubmit}
        className="rounded bg-stone-800 px-4 py-2 font-medium text-white disabled:opacity-60"
      >
        Create account
      </button>
    </form>
  );
}

export default withQuery(CreateUserForm);
