import { useEffect, useState } from "react";
import { useT } from "../i18n/index.tsx";
import { errorText } from "./ui.ts";
import { connectWallet, hasWallet, walletErrorText } from "./wallet.ts";

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** The value to send, or `null` when the field is empty or not an EVM address. */
export function validReturnAddress(value: string): string | null {
  const trimmed = value.trim();
  return EVM_ADDRESS.test(trimmed) ? trimmed : null;
}

/** Return addresses are EVM addresses; a Solana rail has none to offer. */
export function offersReturnAddress(chain: string | undefined): boolean {
  return chain !== undefined && !chain.startsWith("solana");
}

/**
 * Where to send the deposit back if the payment fails after the money arrived.
 *
 * Optional, and kept apart from the wallet a buyer connects for protection:
 * typing an address here must not turn protection on. Without one, a failed
 * payment's deposit is returned by hand.
 */
export function ReturnAddressField({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const t = useT();
  const invalid = value.trim() !== "" && validReturnAddress(value) === null;
  const [walletError, setWalletError] = useState("");
  // Read after mount, not while rendering: the page is rendered before an extension has
  // always injected itself, and a wallet that announces late says so with this event.
  const [walletAvailable, setWalletAvailable] = useState(false);
  useEffect(() => {
    setWalletAvailable(hasWallet());
    const onInitialized = () => setWalletAvailable(hasWallet());
    window.addEventListener("ethereum#initialized", onInitialized, { once: true });
    return () => window.removeEventListener("ethereum#initialized", onInitialized);
  }, []);

  async function fillFromWallet() {
    setWalletError("");
    try {
      onChange(await connectWallet());
    } catch (cause) {
      setWalletError(walletErrorText(cause, t, "unableToConnectWallet"));
    }
  }

  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center gap-1.5">
        <label className="text-sm text-ink" htmlFor="return-address">
          {t("returnAddress")} <span className="text-muted">· {t("optional")}</span>
        </label>
        <span className="group relative inline-flex">
          <button
            type="button"
            aria-label={t("aboutReturnAddress")}
            aria-describedby="return-address-hint"
            className="flex size-4 items-center justify-center rounded-full border border-line bg-transparent p-0 text-[10px] leading-none text-muted hover:text-ink focus-visible:text-ink"
          >
            i
          </button>
          <span
            id="return-address-hint"
            role="tooltip"
            className="pointer-events-none invisible absolute bottom-full left-1/2 z-10 mb-2 w-64 -translate-x-1/2 rounded-xl border border-line bg-panel p-3 text-xs leading-relaxed text-muted opacity-0 shadow-lg transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
          >
            {t("returnAddressHint")}
          </span>
        </span>
      </div>
      <div className="relative">
        <input
          id="return-address"
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="0x…"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`w-full rounded-xl border border-line bg-panel py-2.5 pl-3 text-sm text-ink ${
            walletAvailable ? "pr-32" : "pr-3"
          }`}
        />
        {walletAvailable && (
          <button
            type="button"
            className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-1.5 rounded-lg border border-line bg-transparent px-2.5 py-1 text-xs text-ink hover:bg-field"
            onClick={() => void fillFromWallet()}
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="size-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
              <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
            </svg>
            {t("useWallet")}
          </button>
        )}
      </div>
      {walletError !== "" && (
        <p className={errorText} role="alert">
          {walletError}
        </p>
      )}
      {invalid && (
        <p className={errorText} role="alert">
          {t("invalidAddress")}
        </p>
      )}
    </div>
  );
}
