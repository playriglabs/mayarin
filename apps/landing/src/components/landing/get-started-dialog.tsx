import { useEffect, useRef } from "preact/hooks";

const SIGN_UP_URL = "https://dashboard.mayarin.xyz/register";
const LOG_IN_URL = "https://dashboard.mayarin.xyz/login";
const SANDBOX_URL = "https://dashboard-testnet.mayarin.xyz/register";

/**
 * The two ways in: a live account, or the sandbox. `<dialog>` supplies the top
 * layer, Escape and the focus trap, as in the capabilities reader.
 */
export function GetStartedDialog({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
      // Lenis keeps scrolling the page underneath otherwise.
      document.documentElement.style.overflow = "hidden";
    } else if (dialog.open) {
      dialog.close();
    }
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label="Get started"
      class="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none bg-transparent p-0 backdrop:bg-ink/60 backdrop:backdrop-blur-sm open:flex open:items-center open:justify-center"
    >
      <div class="w-[min(92vw,480px)] rounded-3xl border border-line bg-paper p-2 shadow-2xl">
        <div class="flex items-center justify-between px-4 py-3 text-sm text-slate-600">
          Get started
          <button
            type="button"
            onClick={() => ref.current?.close()}
            aria-label="Close"
            class="grid size-8 cursor-pointer place-items-center rounded-full transition-colors hover:text-ink"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <path d="m6 6 12 12M6 18 18 6" />
            </svg>
          </button>
        </div>

        <div class="rounded-2xl bg-v2-mist px-6 py-8 text-center sm:px-10 sm:py-10">
          <h2 class="text-[clamp(1.6rem,4vw,2rem)]!">Welcome to Mayarin</h2>
          <p class="mt-3 text-base text-slate-600">
            Price in your currency, settle in a stablecoin.
          </p>

          <a
            href={SIGN_UP_URL}
            class="mt-8 flex h-12 items-center justify-center rounded-full bg-ink text-sm font-medium text-paper transition-colors duration-200 hover:bg-brand"
          >
            Get started
          </a>
          <p class="mt-3 text-sm text-slate-600">
            Create your account and start accepting payments.
          </p>

          <div class="my-6 flex items-center gap-4 text-sm text-slate-600">
            <span class="h-px flex-1 bg-line" />
            or
            <span class="h-px flex-1 bg-line" />
          </div>

          <a
            href={SANDBOX_URL}
            class="flex h-12 items-center justify-center rounded-full border border-line bg-paper text-sm font-medium transition-colors duration-200 hover:border-brand hover:text-brand"
          >
            Try the sandbox
          </a>
          <p class="mt-3 text-sm text-slate-600">Test data and mock payments. No setup required.</p>

          <p class="mt-8 text-sm text-slate-600">
            Already have an account?{" "}
            <a href={LOG_IN_URL} class="text-ink underline underline-offset-4 hover:text-brand">
              Log in
            </a>
          </p>
        </div>
      </div>
    </dialog>
  );
}
