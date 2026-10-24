import { type ReactNode, useEffect, useState } from "react";
import { useT } from "../i18n/index.tsx";
import { protectionApplies } from "./buyer-protection.tsx";
import { RAIL_SLOT, RailSentence } from "./rail-picker.tsx";
import type { Protection, Rail } from "./types.ts";
import { errorText, noteText, primaryButton } from "./ui.ts";

/** Where the page's rails belong: a payment link, or an intent already minted. */
export type RailSource = { readonly linkId: string } | { readonly paymentId: string };

/**
 * The rail a local-currency payment is delivered on, as the server decides it.
 *
 * The page does not pick: the merchant's chosen chain, then the rail that needs
 * no conversion, then the cheaper chain — a rule held on the server so the
 * merchant's setting applies. The page only says which rails it already offers.
 *
 * Absent when the deployment has no TransFi, when none of this payment's rails
 * is one it can deliver to, or when the payment is escrowed — a wallet is part of
 * an escrowed payment's terms and a local-currency payer has none to name. Then
 * the option is simply not offered, and the crypto path is untouched.
 */
export function useLocalCurrencyRail(
  rails: readonly Rail[],
  protection: Protection | null,
  source: RailSource,
): Rail | undefined {
  const [chosen, setChosen] = useState<Rail | undefined>(undefined);
  // One string for what the server is asked, so the effect re-runs only when the
  // question changes — not on every render that rebuilds the `source` object.
  const question = JSON.stringify({
    ...source,
    rails: rails.map((rail) => ({
      chain: rail.chain,
      asset: rail.asset,
      settlementAsset: rail.settlementAsset,
    })),
  });

  useEffect(() => {
    let cancelled = false;
    fetch("/v1/fiat-onramp/rail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: question,
    })
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as {
          rail: { chain: string; asset: string } | null;
        };
        if (cancelled || body.rail === null) return;
        const { chain, asset } = body.rail;
        // Back to the page's own rail object, which carries the contract the
        // intent is confirmed with.
        setChosen(rails.find((rail) => rail.chain === chain && rail.asset === asset));
      })
      .catch(() => {
        // No local-currency option; the crypto path is unaffected.
      });
    return () => {
      cancelled = true;
    };
  }, [question, rails]);

  if (chosen === undefined) return undefined;
  if (protection?.required === true && protectionApplies(protection, chosen)) return undefined;
  return chosen;
}

export type PaymentMethod = "crypto" | "local";

/**
 * How the payer pays, before anything about the rail: crypto from a wallet, or
 * their own currency. Two tiles at the top of the panel, the way a card form
 * leads with its method — the choice changes what is asked below it.
 */
export function PaymentMethodTabs({
  value,
  onChange,
  disabled,
}: {
  readonly value: PaymentMethod;
  readonly onChange: (method: PaymentMethod) => void;
  readonly disabled: boolean;
}) {
  const t = useT();
  return (
    <fieldset className="m-0 mt-6 grid min-w-0 grid-cols-2 gap-3 border-0 p-0">
      <legend className="sr-only">{t("paymentMethod")}</legend>
      <MethodTile
        selected={value === "crypto"}
        disabled={disabled}
        onSelect={() => onChange("crypto")}
        title={t("methodCrypto")}
        hint={t("methodCryptoHint")}
        icon={
          <path
            d="M3 7.5A2.5 2.5 0 0 1 5.5 5H19v3M3 7.5V17a2 2 0 0 0 2 2h14V8H5.5A2.5 2.5 0 0 1 3 7.5ZM16 13.5h.01"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        }
      />
      <MethodTile
        selected={value === "local"}
        disabled={disabled}
        onSelect={() => onChange("local")}
        title={t("methodLocal")}
        hint={t("methodLocalHint")}
        icon={
          <path
            d="M3 6h18v12H3zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM6.5 12h.01M17.5 12h.01"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        }
      />
    </fieldset>
  );
}

function MethodTile({
  selected,
  disabled,
  onSelect,
  title,
  hint,
  icon,
}: {
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly onSelect: () => void;
  readonly title: string;
  readonly hint: string;
  readonly icon: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
      className={`flex min-h-20 flex-col items-start justify-between gap-2 rounded-xl border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        selected
          ? "border-ink bg-ink text-panel"
          : "border-line bg-panel text-ink enabled:hover:bg-field"
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="size-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        {icon}
      </svg>
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs opacity-70">{hint}</span>
      </span>
    </button>
  );
}

/**
 * What the local-currency tile shows in place of the rail picker.
 *
 * The identity form is not here: TransFi needs the deposit address of a locked
 * intent, and minting one on a tile click would burn an address per curious
 * visitor. So this confirms the intent and the next page opens on the form.
 */
export function LocalCurrencyPanel({
  busy,
  error,
  lockMinutes,
  rail,
  onContinue,
}: {
  readonly busy: boolean;
  readonly error: string;
  readonly lockMinutes: number;
  /** Where the payment is delivered. Shown, because nobody else decides it at the till. */
  readonly rail: Rail;
  readonly onContinue: () => void;
}) {
  const t = useT();
  return (
    <div className="mt-6">
      <p className="m-0 text-sm text-muted">{t("localCurrencyIntro")}</p>
      <p className="mt-4 mb-0 text-xs text-muted">
        <RailSentence text={t("deliveredAs", { rail: RAIL_SLOT })} rail={rail} />
      </p>
      <button
        type="button"
        className={`${primaryButton} mt-6`}
        disabled={busy}
        onClick={onContinue}
      >
        {busy ? t("preparingPayment") : t("continueInLocal")}
      </button>
      {error !== "" && (
        <p className={errorText} role="alert">
          {error}
        </p>
      )}
      <p className={`${noteText} text-center`}>{t("localLockNote", { minutes: lockMinutes })}</p>
    </div>
  );
}
