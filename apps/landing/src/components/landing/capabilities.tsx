import { capabilitySnippets, type Snippet } from "virtual:code-snippets";
import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { Reveal } from "../reveal.tsx";
import { CapabilityVisual } from "./capability-visuals.tsx";
import { LanguageMark } from "./language-mark.tsx";
import { SectionIntro } from "./ui.tsx";

export type CapabilityKind = "accept" | "route" | "settle" | "agent";

const CAPABILITIES = [
  {
    id: "accept",
    title: "Accept money",
    description: "Take a payment at your own prices, in the currency your business already uses.",
    chips: ["Hosted checkout", "Payment links", "Invoices", "Products & carts"],
  },
  {
    id: "route",
    title: "Route money",
    description: "The payer brings any supported asset. You never have to pick the pair.",
    chips: ["Cross-asset quotes", "Oracle guard", "Uniswap venues", "Deposit addresses"],
  },
  {
    id: "settle",
    title: "Settle money",
    description: "Stablecoins land in your own wallet, against a ledger that balances itself.",
    chips: ["Merchant Safe", "On-chain settlement", "Double-entry ledger", "Signed webhooks"],
  },
  {
    id: "agent",
    title: "Charge an agent",
    description: "One signature for an exact amount. No account, no key, no gas to understand.",
    chips: ["x402", "EIP-3009", "Per-request pricing", "Cross-asset"],
  },
] as const satisfies readonly {
  readonly id: CapabilityKind;
  readonly title: string;
  readonly description: string;
  readonly chips: readonly string[];
}[];

const SNIPPETS = new Map(capabilitySnippets.map((snippet) => [snippet.id, snippet]));

function CopyIcon({ copied }: { readonly copied: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {copied ? (
        <path d="m5 12 4 4L19 6" />
      ) : (
        <>
          <rect x="9" y="9" width="12" height="12" rx="2" />
          <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
        </>
      )}
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <path d="m6 6 12 12M6 18 18 6" />
    </svg>
  );
}

function Arrow() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      aria-hidden="true"
    >
      <path d="M7 17 17 7M9 7h8v8" />
    </svg>
  );
}

/**
 * The code the card shows on hover and the code the dialog shows are the same
 * markup, so the transition between them is a change of frame rather than a
 * second rendering of the snippet.
 */
function CodePanel({ snippet, class: className = "" }: { snippet: Snippet; class?: string }) {
  return (
    <div class={clsx("flex min-h-0 flex-col bg-code-panel", className)}>
      <div class="flex shrink-0 items-center gap-3 border-b border-line-inverse px-5 py-3.5">
        <LanguageMark lang={snippet.lang} />
        <span class="text-[13px] font-sans text-slate-inverse">{snippet.filename}</span>
      </div>
      {/* Shiki output, generated at build time from a checked-in file. */}
      <div
        class="code-surface min-h-0 flex-1 overflow-auto"
        dangerouslySetInnerHTML={{ __html: snippet.html }}
      />
    </div>
  );
}

/**
 * A full-viewport reader for one example. `<dialog>` earns its place here: the
 * top layer, the Escape key, the focus trap and the inert page behind it are
 * all the platform's, so none of them is reimplemented and none can drift.
 */
function CodeDialog({
  snippet,
  title,
  onClose,
}: {
  readonly snippet: Snippet | undefined;
  readonly title: string | undefined;
  readonly onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (snippet) {
      if (!dialog.open) dialog.showModal();
      // Lenis keeps scrolling the page underneath otherwise.
      document.documentElement.style.overflow = "hidden";
    } else if (dialog.open) {
      dialog.close();
    }
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [snippet]);

  useEffect(() => setCopied(false), [snippet]);

  const copy = () => {
    if (!snippet) return;
    void navigator.clipboard?.writeText(snippet.code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label={title ? `${title} — SDK example` : "SDK example"}
      class="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none bg-transparent p-0 backdrop:bg-ink/70 backdrop:backdrop-blur-sm open:flex open:items-center open:justify-center"
    >
      {snippet && (
        <div class="flex h-full max-h-full w-full flex-col overflow-hidden md:h-[min(84vh,760px)] md:w-[min(92vw,1040px)] md:rounded-2xl md:shadow-2xl">
          <div class="flex shrink-0 items-center justify-between gap-5 border-b border-line-inverse bg-code-panel px-5 py-3.5">
            <div class="flex items-center gap-3">
              <LanguageMark lang={snippet.lang} />
              <span class="text-[13px] font-sans text-slate-inverse">{snippet.filename}</span>
            </div>
            <div class="flex items-center gap-5">
              <button
                type="button"
                onClick={copy}
                class="label inline-flex cursor-pointer items-center gap-2 text-slate-inverse transition-colors duration-200 hover:text-white"
              >
                <CopyIcon copied={copied} />
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                onClick={() => ref.current?.close()}
                aria-label="Close the example"
                class="label inline-flex cursor-pointer items-center gap-2 text-slate-inverse transition-colors duration-200 hover:text-white"
              >
                Esc
                <CloseIcon />
              </button>
            </div>
          </div>
          <div
            class="code-surface min-h-0 flex-1 overflow-auto overscroll-contain bg-code-panel"
            data-lenis-prevent
            dangerouslySetInnerHTML={{ __html: snippet.html }}
          />
        </div>
      )}
    </dialog>
  );
}

export function Capabilities() {
  const [open, setOpen] = useState<CapabilityKind | undefined>(undefined);
  const opener = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => {
    setOpen(undefined);
    opener.current?.focus();
    opener.current = null;
  }, []);

  const active = open ? CAPABILITIES.find((item) => item.id === open) : undefined;

  return (
    <section id="capabilities" class="mx-auto w-full max-w-300 px-6 py-20 md:px-10 md:py-28">
      <Reveal>
        <SectionIntro
          centered={false}
          title={
            <>
              Everything a payment needs.
              <br />
              <span>Nothing you have to assemble.</span>
            </>
          }
        />
      </Reveal>

      <Reveal delay={120} class="mt-14 grid gap-5 md:grid-cols-2">
        {CAPABILITIES.map((item) => {
          const snippet = SNIPPETS.get(item.id);
          return (
            <button
              key={item.id}
              type="button"
              onClick={(event) => {
                opener.current = event.currentTarget;
                setOpen(item.id);
              }}
              aria-haspopup="dialog"
              class="group relative flex cursor-pointer flex-col overflow-hidden rounded-3xl border border-line bg-v2-mist/60 p-7 text-left transition-colors duration-380 ease-out-expo hover:border-forest/25 md:p-9"
            >
              <div class="flex items-start justify-between gap-5">
                <h4 class="text-2xl font-sans md:text-[1.75rem] font-normal">{item.title}</h4>
                <span
                  aria-hidden="true"
                  class="flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-paper text-ink transition-colors duration-300 group-hover:border-ink group-hover:bg-ink group-hover:text-paper"
                >
                  <Arrow />
                </span>
              </div>
              <p class="mt-3 max-w-[46ch] text-sm leading-relaxed text-slate">{item.description}</p>

              <div class="mt-6 flex flex-wrap gap-2">
                {item.chips.map((chip) => (
                  <span
                    key={chip}
                    class="rounded-full bg-paper px-3.5 py-1.5 text-xs text-slate ring-1 ring-inset ring-line"
                  >
                    {chip}
                  </span>
                ))}
              </div>

              {/* Two layers on one cell: the illustration rests, the code answers. */}
              <div class="relative mt-8 flex-1">
                <div class="transform-gpu transition-[opacity,transform] duration-380 ease-out-expo group-hover:-translate-y-1 group-hover:opacity-0 group-focus-visible:-translate-y-1 group-focus-visible:opacity-0 motion-safe:will-change-[opacity,transform] motion-reduce:transition-none">
                  <CapabilityVisual kind={item.id} />
                </div>
                {snippet && (
                  <div
                    aria-hidden="true"
                    class="pointer-events-none absolute inset-0 translate-y-1 transform-gpu overflow-hidden rounded-xl opacity-0 transition-[opacity,transform] duration-560 ease-out-expo contain-[paint] group-hover:translate-y-0 group-hover:opacity-100 group-hover:delay-90 group-focus-visible:translate-y-0 group-focus-visible:opacity-100 group-focus-visible:delay-90 motion-safe:will-change-[opacity,transform] motion-reduce:transition-none"
                  >
                    <CodePanel snippet={snippet} class="h-full [&_.code-surface]:overflow-hidden" />
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </Reveal>

      <CodeDialog
        snippet={open ? SNIPPETS.get(open) : undefined}
        title={active?.title}
        onClose={close}
      />
    </section>
  );
}
