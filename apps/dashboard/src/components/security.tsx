/**
 * Account security: the authenticator-app second factor (SEC-15, SEC-16).
 *
 * Three states, matched exhaustively: not enabled, enrolling (a secret has been
 * issued and a code is awaited), and enabled. Enabling is only real once a code
 * from the app has been accepted, which is why setup and confirmation are two
 * steps on one screen rather than one action.
 */

import { CheckIcon, CopyIcon, ShieldCheckIcon, ShieldWarningIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CodeInput } from "@/components/ui/code-input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageLoader } from "@/components/ui/page-loader";
import { useChangePassword, useMe, useMfaDisable, useMfaSetup, useMfaVerify } from "@/hooks/auth";
import { ApiError } from "@/lib/api/client";
import type { MfaSetupResponse } from "@/types/auth";

function reasonOf(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Try again.";
}

/** The QR, as an image: an SVG in an `<img>` cannot run script, markup injection could. */
function qrSource(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function CopyButton({
  value,
  label,
  size = "sm",
  className,
}: {
  readonly value: string;
  readonly label: string;
  readonly size?: "sm" | "default";
  readonly className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      size={size}
      {...(className === undefined ? {} : { className })}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1_500);
      }}
    >
      {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

function Enrolling({
  setup,
  onDone,
  onCancel,
}: {
  readonly setup: MfaSetupResponse;
  readonly onDone: (recoveryCodes: readonly string[]) => void;
  readonly onCancel: () => void;
}) {
  const verify = useMfaVerify();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  /** Takes the code: `onComplete` fires inside the keystroke, before state updates. */
  function submit(submitted: string) {
    if (verify.isPending || submitted.length !== 6) return;
    setError(null);
    verify.mutate(
      { code: submitted },
      {
        onSuccess: (result) => onDone(result.recoveryCodes),
        onError: (failure) => {
          setCode("");
          setError(reasonOf(failure));
        },
      },
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit(code);
      }}
      className="flex flex-col gap-5"
    >
      <ol className="flex flex-col gap-5 text-sm">
        <li className="flex flex-col gap-3">
          <span className="font-medium text-foreground">
            1. Scan this code with Google Authenticator
          </span>
          <img
            src={qrSource(setup.qrSvg)}
            alt="QR code for your authenticator app"
            width={176}
            height={176}
            className="size-44 rounded-md border border-border bg-white p-2"
          />
          <details className="text-muted-foreground">
            <summary className="cursor-pointer">Cannot scan? Enter the key by hand</summary>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="rounded bg-muted px-2 py-1 font-mono text-xs break-all">
                {setup.secret}
              </code>
              <CopyButton value={setup.secret} label="Copy key" />
            </div>
          </details>
        </li>
        <li className="flex flex-col gap-3">
          <span className="font-medium text-foreground">
            2. Enter the 6-digit code it shows to confirm
          </span>
          <Field>
            <FieldLabel id="mfa-setup-label" htmlFor="mfa-setup-code" className="sr-only">
              Authentication code
            </FieldLabel>
            <CodeInput
              id="mfa-setup-code"
              value={code}
              onChange={setCode}
              length={6}
              disabled={verify.isPending}
              invalid={error !== null}
              labelledBy="mfa-setup-label"
              {...(error === null ? {} : { describedBy: "mfa-setup-error" })}
              onComplete={submit}
            />
          </Field>
          {error === null ? null : (
            <p id="mfa-setup-error" role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </li>
      </ol>
      <div className="flex gap-2">
        <Button type="submit" className="flex-1" disabled={verify.isPending || code.length !== 6}>
          {verify.isPending ? "Verifying…" : "Verify and enable"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="flex-1"
          onClick={onCancel}
          disabled={verify.isPending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

function RecoveryCodes({
  codes,
  onAcknowledge,
}: {
  readonly codes: readonly string[];
  readonly onAcknowledge: () => void;
}) {
  const [saved, setSaved] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <ul className="grid grid-cols-2 gap-2 font-mono text-sm">
        {codes.map((code) => (
          <li key={code} className="rounded bg-muted px-3 py-2 text-center">
            {code}
          </li>
        ))}
      </ul>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />I have
        saved these somewhere safe
      </label>
      <div className="flex gap-2">
        <CopyButton value={codes.join("\n")} label="Copy all" size="default" className="flex-1" />
        <Button type="button" className="flex-1" disabled={!saved} onClick={onAcknowledge}>
          Done
        </Button>
      </div>
    </div>
  );
}

function Disable({ onDone }: { readonly onDone: () => void }) {
  const disable = useMfaDisable();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  function close(next: boolean) {
    setOpen(next);
    if (next) return;
    setCode("");
    setError(null);
  }

  return (
    <>
      <Button type="button" variant="destructive" onClick={() => setOpen(true)}>
        Turn off
      </Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Turn off two-factor authentication</DialogTitle>
            <DialogDescription>
              Withdrawals and payouts are blocked again until you turn it back on.
            </DialogDescription>
          </DialogHeader>
          <form
            id="mfa-disable-form"
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              setError(null);
              disable.mutate(
                { code: code.trim() },
                {
                  onSuccess: () => {
                    close(false);
                    toast.success("Two-factor authentication turned off");
                    onDone();
                  },
                  onError: (failure) => setError(reasonOf(failure)),
                },
              );
            }}
          >
            <Field>
              <FieldLabel
                id="mfa-disable-label"
                htmlFor="mfa-disable-code"
                className="mb-1 text-sm"
              >
                Enter a code to turn it off
              </FieldLabel>
              <CodeInput
                id="mfa-disable-code"
                value={code}
                onChange={setCode}
                length={6}
                disabled={disable.isPending}
                invalid={error !== null}
                labelledBy="mfa-disable-label"
              />
            </Field>
            {error === null ? null : (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </form>
          <DialogFooter>
            <DialogClose
              render={
                <Button variant="secondary" className="flex-1">
                  Cancel
                </Button>
              }
            />
            <Button
              type="submit"
              form="mfa-disable-form"
              className="flex-1"
              variant="destructive"
              disabled={disable.isPending || code.length !== 6}
            >
              Turn off two-factor
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

type View =
  | { readonly kind: "overview" }
  | { readonly kind: "enrolling"; readonly setup: MfaSetupResponse }
  | { readonly kind: "recovery"; readonly codes: readonly string[] };

/** Rendered inside Settings, which already supplies the query client. */
export function SecuritySection() {
  const me = useMe();
  const setup = useMfaSetup();
  const [view, setView] = useState<View>({ kind: "overview" });

  if (me.isPending) return <PageLoader label="Loading security settings" />;
  const enabled = me.data?.mfaEnabled === true;

  return (
    <Card id="security" className="gap-5 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {enabled ? (
            <ShieldCheckIcon size={28} className="text-success" aria-hidden="true" />
          ) : (
            <ShieldWarningIcon size={28} className="text-warning" aria-hidden="true" />
          )}
          <div className="flex flex-col gap-1">
            <h3 className="font-medium text-foreground text-sm">Two-factor authentication</h3>
            <p className="text-sm text-muted-foreground">
              A code from an authenticator app such as Google Authenticator, asked at sign-in and
              before you withdraw funds, change a wallet or send a payout.
            </p>
          </div>
        </div>
        <Badge variant={enabled ? "success" : "warning"}>{enabled ? "On" : "Off"}</Badge>
      </div>

      {enabled ? (
        <Disable onDone={() => void me.refetch()} />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Until this is on, withdrawals and payouts are blocked on your account.
          </p>
          <div>
            <Button
              type="button"
              disabled={setup.isPending}
              onClick={() =>
                setup.mutate(undefined, {
                  onSuccess: (result) => setView({ kind: "enrolling", setup: result }),
                  onError: (failure) => toast.error(reasonOf(failure)),
                })
              }
            >
              {setup.isPending ? "Preparing…" : "Set up authenticator app"}
            </Button>
          </div>
        </div>
      )}

      {/* The recovery codes are shown once, so that step cannot be dismissed by
          Escape or a click outside: only "Done", after the user says they saved them. */}
      <Dialog
        open={view.kind !== "overview"}
        onOpenChange={(next) => {
          if (!next && view.kind === "enrolling") setView({ kind: "overview" });
        }}
      >
        <DialogContent>
          {view.kind === "enrolling" ? (
            <>
              <DialogHeader>
                <DialogTitle>Set up authenticator app</DialogTitle>
                <DialogDescription>
                  Scan the code, then enter what the app shows to turn it on.
                </DialogDescription>
              </DialogHeader>
              <Enrolling
                setup={view.setup}
                onDone={(codes) => setView({ kind: "recovery", codes })}
                onCancel={() => setView({ kind: "overview" })}
              />
            </>
          ) : view.kind === "recovery" ? (
            <>
              <DialogHeader>
                <DialogTitle>Save your recovery codes</DialogTitle>
                <DialogDescription>
                  Each works once, in place of an authenticator code, if you lose your phone. They
                  are shown only now.
                </DialogDescription>
              </DialogHeader>
              <RecoveryCodes
                codes={view.codes}
                onAcknowledge={() => {
                  setView({ kind: "overview" });
                  void me.refetch();
                }}
              />
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** Changes the password in a dialog; every other device is signed out. */
export function PasswordSection() {
  const me = useMe();
  const change = useChangePassword();
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mfaEnabled = me.data?.mfaEnabled === true;

  function close(next: boolean) {
    setOpen(next);
    if (next) return;
    setCurrentPassword("");
    setNewPassword("");
    setCode("");
    setError(null);
  }

  function submit(event: { preventDefault(): void }) {
    event.preventDefault();
    setError(null);
    change.mutate(
      { currentPassword, newPassword, ...(mfaEnabled ? { code } : {}) },
      {
        onSuccess: () => {
          close(false);
          toast.success("Password changed. Other devices were signed out.");
        },
        onError: (failure) => setError(reasonOf(failure)),
      },
    );
  }

  return (
    <Card id="password" className="gap-5 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="font-medium text-foreground text-sm">Password</h3>
          <p className="text-sm text-muted-foreground">Changing it signs out every other device.</p>
        </div>
        <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
          Change password
        </Button>
      </div>

      <Dialog open={open} onOpenChange={close}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change password</DialogTitle>
            <DialogDescription>
              Every other device is signed out once it is changed.
            </DialogDescription>
          </DialogHeader>
          <form id="change-password-form" onSubmit={submit} className="flex flex-col gap-3">
            <Field>
              <FieldLabel htmlFor="current-password">Current password</FieldLabel>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-password">New password (12 characters or more)</FieldLabel>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </Field>
            {mfaEnabled ? (
              <Field>
                <FieldLabel htmlFor="password-mfa">Authenticator or recovery code</FieldLabel>
                <Input
                  id="password-mfa"
                  autoComplete="one-time-code"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </Field>
            ) : null}
            {error === null ? null : (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </form>
          <DialogFooter>
            <DialogClose render={<Button variant="secondary">Cancel</Button>} />
            <Button type="submit" form="change-password-form" disabled={change.isPending}>
              {change.isPending ? "Changing…" : "Change password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
