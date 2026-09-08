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

import { UserPlusIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { match } from "ts-pattern";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAdminUsers, useCreateUser } from "@/hooks/admin";
import { ApiError } from "@/lib/api/client";
import { withQuery } from "@/lib/with-query";
import { PERMISSION_LABELS, PERMISSION_LIST, type Permission } from "@/types/user";

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
  const users = useAdminUsers();
  const create = useCreateUser();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<FormState>({ status: "idle" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [perms, setPerms] = useState<Set<Permission>>(new Set<Permission>(["payments:read"]));

  const submitting = create.isPending || state.status === "submitting";
  const passwordInvalid = password.length > 0 && password.length < 12;
  const canSubmit = email.trim() !== "" && perms.size > 0 && !passwordInvalid && !submitting;

  useEffect(() => {
    const show = () => {
      setState({ status: "idle" });
      setOpen(true);
    };
    window.addEventListener("mayarin:grant-account", show);
    return () => window.removeEventListener("mayarin:grant-account", show);
  }, []);

  function changeOpen(next: boolean) {
    setOpen(next);
    if (next) setState({ status: "idle" });
  }

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

  if (users.isPending) return null;

  return (
    <div id="grant-account" className="flex justify-end">
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogTrigger
          render={
            <Button>
              <UserPlusIcon size={16} weight="bold" aria-hidden="true" />
              Grant account
            </Button>
          }
        />
        <DialogContent className="max-h-[calc(100vh-2rem)] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Grant an account</DialogTitle>
            <DialogDescription>New accounts are scoped to this merchant only.</DialogDescription>
          </DialogHeader>

          <form onSubmit={onSubmit} className="flex flex-col gap-5">
            <div className="flex flex-col gap-3">
              <Field>
                <FieldLabel htmlFor="new-user-email">Email</FieldLabel>
                <Input
                  id="new-user-email"
                  type="email"
                  required
                  autoComplete="off"
                  placeholder="teammate@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={submitting}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="new-user-password">Password</FieldLabel>
                <Input
                  id="new-user-password"
                  type="text"
                  autoComplete="new-password"
                  placeholder="Leave blank to auto-generate"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={submitting}
                  aria-invalid={passwordInvalid}
                  aria-describedby="new-user-password-hint"
                  className="font-mono text-xs"
                />
                <FieldDescription id="new-user-password-hint">
                  Leave blank to auto-generate a strong password. If set, at least 12 characters.
                </FieldDescription>
                {passwordInvalid && (
                  <FieldError>Password must be at least 12 characters.</FieldError>
                )}
              </Field>
            </div>

            <FieldSet>
              <FieldLegend className="mb-3">Permissions</FieldLegend>
              {PERMISSION_LIST.map((p) => {
                // `Checkbox` renders a <button role="checkbox">. A button IS a
                // labelable element, so `htmlFor` both names it and toggles it on
                // click — which wrapping it in the label would NOT have done.
                const id = `perm-${p.replace(":", "-")}`;
                return (
                  <div key={p} className="flex items-center gap-2">
                    <Checkbox
                      id={id}
                      checked={perms.has(p)}
                      onCheckedChange={() => togglePerm(p)}
                      disabled={submitting}
                    />
                    <Label htmlFor={id} className="cursor-pointer text-sm text-foreground">
                      {PERMISSION_LABELS[p]}
                    </Label>
                  </div>
                );
              })}
            </FieldSet>

            <div aria-live="polite" className="empty:hidden">
              {match(state)
                .with({ status: "idle" }, () => null)
                .with({ status: "submitting" }, () => (
                  <p className="text-xs text-subtle-foreground">Creating account…</p>
                ))
                .with({ status: "error" }, (s) => <Alert variant="destructive">{s.reason}</Alert>)
                .with({ status: "created" }, (s) => (
                  <div className="rounded-lg border border-border bg-brand-muted px-3 py-2">
                    <p className="text-xs font-medium text-success">Account created.</p>
                    {s.generatedPassword !== undefined ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Generated password (store it now):{" "}
                        <code className="font-mono text-foreground">{s.generatedPassword}</code>
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground">
                        The supplied password is active.
                      </p>
                    )}
                  </div>
                ))
                .exhaustive()}
            </div>

            <DialogFooter>
              <DialogClose
                render={
                  <Button type="button" variant="secondary">
                    Cancel
                  </Button>
                }
              />
              <Button type="submit" variant="default" disabled={!canSubmit}>
                Create account
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default withQuery(CreateUserForm);
