/**
 * The bridge between the API client and the step-up dialog (SEC-16).
 *
 * Routes that move funds answer `403 mfa_code_required` until the request
 * carries a fresh authenticator code. The client cannot ask the person
 * anything, and no form should have to know the rule, so it asks this module
 * for a code and retries with it. A host component (`MfaStepUpHost`) is the one
 * thing that can show the question; with none mounted the request simply fails
 * with the API's own message.
 */

export type StepUpPrompt =
  | {
      readonly kind: "code";
      /** The previous code was wrong. */
      readonly invalid: boolean;
      readonly resolve: (code: string | null) => void;
    }
  | { readonly kind: "setup"; readonly resolve: () => void };

let listener: ((prompt: StepUpPrompt) => void) | undefined;

/** Registers the dialog host. Returns the unregister function. */
export function registerStepUpHost(next: (prompt: StepUpPrompt) => void): () => void {
  listener = next;
  return () => {
    if (listener === next) listener = undefined;
  };
}

/** A code from the person, or `null` if they cancel or there is nobody to ask. */
export function requestMfaCode(invalid = false): Promise<string | null> {
  const host = listener;
  if (host === undefined) return Promise.resolve(null);
  return new Promise((resolve) => host({ kind: "code", invalid, resolve }));
}

/** Tells the person the account has no second factor yet and where to set one up. */
export function announceMfaSetupRequired(): Promise<void> {
  const host = listener;
  if (host === undefined) return Promise.resolve();
  return new Promise((resolve) => host({ kind: "setup", resolve: () => resolve() }));
}
