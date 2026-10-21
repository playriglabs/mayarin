/**
 * The question a funds-moving action asks (SEC-16): the code from the person's
 * authenticator app, or a note that they have not set one up yet.
 *
 * Mounted once, in the dashboard layout, so every page can ask. It owns no logic
 * about *when* to ask; the API client does that and calls in through `lib/mfa-step-up`.
 */

import { ShieldCheckIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CodeInput } from "@/components/ui/code-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { registerStepUpHost, type StepUpPrompt } from "@/lib/mfa-step-up";

/** A recovery code is eight characters shown as two groups of four: `XXXX-XXXX`. */
const RECOVERY_CODE_LENGTH = 8;
const RECOVERY_GROUP_SIZE = 4;
export function MfaStepUpHost() {
  const [prompt, setPrompt] = useState<StepUpPrompt | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);

  useEffect(() => registerStepUpHost(setPrompt), []);

  // Tells the stylesheet to hide whatever dialog asked, for as long as we ask.
  useEffect(() => {
    if (prompt === null) {
      delete document.body.dataset.mfaStepUp;
      return;
    }
    document.body.dataset.mfaStepUp = "";
    return () => {
      delete document.body.dataset.mfaStepUp;
    };
  }, [prompt]);

  function finishCode(value: string | null) {
    if (prompt?.kind === "code") prompt.resolve(value);
    setPrompt(null);
    setCode("");
    setRecovery(false);
  }

  function finishSetup() {
    if (prompt?.kind === "setup") prompt.resolve();
    setPrompt(null);
  }

  return (
    <>
      <Dialog open={prompt?.kind === "code"} onOpenChange={(open) => !open && finishCode(null)}>
        <DialogContent className="max-w-sm" data-mfa-step-up-dialog="">
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (code.length === (recovery ? RECOVERY_CODE_LENGTH : 6)) finishCode(code);
            }}
          >
            <DialogHeader>
              <DialogTitle className="text-[17px]">Confirm with your authenticator</DialogTitle>
              <DialogDescription className="mt-1">
                Enter the 6-digit code from your authenticator app, or one of your recovery codes.
              </DialogDescription>
            </DialogHeader>
            <CodeInput
              key={recovery ? "recovery" : "totp"}
              id="mfa-step-up-code"
              value={code}
              onChange={setCode}
              length={recovery ? RECOVERY_CODE_LENGTH : 6}
              {...(recovery ? { groupSize: RECOVERY_GROUP_SIZE, alphanumeric: true } : {})}
              invalid={prompt?.kind === "code" && prompt.invalid}
              describedBy="mfa-step-up-error"
              onComplete={(next) => finishCode(next)}
            />
            <button
              type="button"
              className="cursor-pointer self-start text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
              onClick={() => {
                setRecovery((previous) => !previous);
                setCode("");
              }}
            >
              {recovery ? "Use your authenticator app" : "Use a recovery code instead"}
            </button>
            {prompt?.kind === "code" && prompt.invalid ? (
              <p id="mfa-step-up-error" role="alert" className="text-xs text-destructive">
                That code was not accepted. Wait for the next one and try again.
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => finishCode(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={code.length !== (recovery ? RECOVERY_CODE_LENGTH : 6)}
              >
                Confirm
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={prompt?.kind === "setup"} onOpenChange={(open) => !open && finishSetup()}>
        <DialogContent className="max-w-sm" data-mfa-step-up-dialog="">
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
            <Button
              type="button"
              onClick={() => window.location.assign("/settings?tab=general#security")}
            >
              Set up now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
