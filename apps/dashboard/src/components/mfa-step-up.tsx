/**
 * The question a funds-moving action asks (SEC-16): the code from the person's
 * authenticator app, or a note that they have not set one up yet.
 *
 * Mounted once per page that can move funds. It owns no logic about *when* to
 * ask; the API client does that and calls in through `lib/mfa-step-up`.
 */

import { ShieldCheckIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { registerStepUpHost, type StepUpPrompt } from "@/lib/mfa-step-up";

export function MfaStepUpHost() {
  const [prompt, setPrompt] = useState<StepUpPrompt | null>(null);
  const [code, setCode] = useState("");

  useEffect(() => registerStepUpHost(setPrompt), []);

  function finishCode(value: string | null) {
    if (prompt?.kind === "code") prompt.resolve(value);
    setPrompt(null);
    setCode("");
  }

  function finishSetup() {
    if (prompt?.kind === "setup") prompt.resolve();
    setPrompt(null);
  }

  return (
    <>
      <Dialog open={prompt?.kind === "code"} onOpenChange={(open) => !open && finishCode(null)}>
        <DialogContent className="max-w-sm">
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (code.trim() !== "") finishCode(code.trim());
            }}
          >
            <DialogHeader>
              <DialogTitle>Confirm with your authenticator</DialogTitle>
              <DialogDescription>
                Enter the 6-digit code from your authenticator app, or one of your recovery codes.
              </DialogDescription>
            </DialogHeader>
            <Input
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              aria-invalid={prompt?.kind === "code" && prompt.invalid}
              aria-describedby="mfa-step-up-error"
              className="h-12 text-center text-lg tracking-widest"
            />
            {prompt?.kind === "code" && prompt.invalid ? (
              <p id="mfa-step-up-error" role="alert" className="text-xs text-destructive">
                That code was not accepted. Wait for the next one and try again.
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => finishCode(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={code.trim() === ""}>
                Confirm
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={prompt?.kind === "setup"} onOpenChange={(open) => !open && finishSetup()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheckIcon aria-hidden="true" /> Set up two-factor authentication
            </DialogTitle>
            <DialogDescription>
              Moving funds, or changing where they go, needs a second factor. Scan a QR code with
              Google Authenticator and confirm one code. It takes a minute.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={finishSetup}>
              Not now
            </Button>
            <Button type="button" onClick={() => window.location.assign("/security")}>
              Set up now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
