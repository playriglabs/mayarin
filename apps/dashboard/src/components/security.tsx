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
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageLoader } from "@/components/ui/page-loader";
import { useMe, useMfaDisable, useMfaSetup, useMfaVerify } from "@/hooks/auth";
import { ApiError } from "@/lib/api/client";
import type { MfaSetupResponse } from "@/types/auth";

function reasonOf(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Try again.";
}

/** The QR, as an image: an SVG in an `<img>` cannot run script, markup injection could. */
function qrSource(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function CopyButton({ value, label }: { readonly value: string; readonly label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
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

  function submit(event: { preventDefault(): void }) {
    event.preventDefault();
    setError(null);
    verify.mutate(
      { code: code.trim() },
      {
        onSuccess: (result) => onDone(result.recoveryCodes),
        onError: (failure) => setError(reasonOf(failure)),
      },
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
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
          <Field className="max-w-60">
            <FieldLabel htmlFor="mfa-setup-code" className="sr-only">
              Authentication code
            </FieldLabel>
            <Input
              id="mfa-setup-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={verify.isPending}
              aria-describedby={error === null ? undefined : "mfa-setup-error"}
              className="h-12 text-center text-lg tracking-widest"
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
        <Button type="submit" disabled={verify.isPending || code.trim() === ""}>
          {verify.isPending ? "Verifying…" : "Verify and enable"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={verify.isPending}>
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
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-medium text-foreground">Save your recovery codes</h3>
        <p className="text-sm text-muted-foreground">
          Each works once, in place of an authenticator code, if you lose your phone. They are shown
          only now.
        </p>
      </div>
      <ul className="grid max-w-md grid-cols-2 gap-2 font-mono text-sm">
        {codes.map((code) => (
          <li key={code} className="rounded bg-muted px-3 py-2 text-center">
            {code}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <CopyButton value={codes.join("\n")} label="Copy all" />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />I
          have saved these somewhere safe
        </label>
      </div>
      <div>
        <Button type="button" disabled={!saved} onClick={onAcknowledge}>
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

  if (!open) {
    return (
      <Button type="button" variant="destructive" onClick={() => setOpen(true)}>
        Turn off
      </Button>
    );
  }
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        disable.mutate(
          { code: code.trim() },
          {
            onSuccess: () => {
              toast.success("Two-factor authentication turned off");
              onDone();
            },
            onError: (failure) => setError(reasonOf(failure)),
          },
        );
      }}
    >
      <Field className="max-w-60">
        <FieldLabel htmlFor="mfa-disable-code" className="text-sm">
          Enter a code to turn it off
        </FieldLabel>
        <Input
          id="mfa-disable-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
          disabled={disable.isPending}
          className="h-12 text-center text-lg tracking-widest"
        />
      </Field>
      {error === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="destructive" disabled={disable.isPending || code === ""}>
          Turn off two-factor
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
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

      {view.kind === "recovery" ? (
        <RecoveryCodes codes={view.codes} onAcknowledge={() => setView({ kind: "overview" })} />
      ) : view.kind === "enrolling" ? (
        <Enrolling
          setup={view.setup}
          onDone={(codes) => setView({ kind: "recovery", codes })}
          onCancel={() => setView({ kind: "overview" })}
        />
      ) : enabled ? (
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
    </Card>
  );
}
