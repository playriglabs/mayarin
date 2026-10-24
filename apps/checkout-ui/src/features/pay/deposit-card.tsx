import { type ReactNode, useId, useState } from "react";
import { useT } from "../../i18n/index.tsx";
import { AssetLogo } from "../../shared/asset-logo.tsx";
import { ChainLabel, ChainLogo } from "../../shared/chain-logo.tsx";
import { walletAmount } from "../../shared/money.ts";
import { chevron } from "../../shared/ui.ts";
import type { Deposit } from "./types.ts";
import type { CopyTarget } from "./use-copy.ts";

/**
 * What to send and where. Both values a payer must reproduce in a wallet — the
 * amount and the address — render in machine form and carry a copy button.
 * The localized `display` form appears only on the fiat "Local price" row.
 */
export function DepositCard({
  deposit,
  localPrice,
  intentId,
  copied,
  onCopy,
}: {
  readonly deposit: Deposit;
  readonly localPrice: string;
  readonly intentId: string;
  readonly copied: CopyTarget | undefined;
  readonly onCopy: (target: CopyTarget, text: string) => void;
}) {
  const t = useT();
  const amount = walletAmount(deposit.amount.formatted);
  // One section open at a time, both closed at rest: the card above already
  // says what to send, where, and on which network. The one rule that loses a
  // payment — wrong asset or network — is stated beside the amount instead.
  const [openSection, setOpenSection] = useState<"details" | "notes" | null>(null);
  const toggle = (section: "details" | "notes") =>
    setOpenSection((current) => (current === section ? null : section));
  const detailsOpen = openSection === "details";
  const notesOpen = openSection === "notes";
  const detailsId = useId();
  const notesId = useId();

  return (
    <>
      <div className="mt-6 overflow-hidden rounded-2xl border border-line">
        <div className="flex flex-col items-center gap-6 p-5 sm:flex-row sm:items-center">
          {/* The bare address, not the payment URI: an exchange or a Phantom scan
              reads an address, and the amount is on the card to type or copy. The
              token and its network sit over the middle, which the code's
              error correction (`level=high`) is sized to lose. */}
          <div className="relative shrink-0 rounded-xl bg-white p-2">
            <img
              className="block size-36"
              alt={t("qrAlt", { asset: deposit.amount.asset, chain: deposit.chain })}
              src={`/checkout/qr?level=high&value=${encodeURIComponent(deposit.address)}`}
            />
            <span className="absolute top-1/2 left-1/2 grid size-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white">
              <AssetLogo symbol={deposit.amount.asset} size={32} />
              <span className="absolute -right-0.5 -bottom-0.5 grid size-4.5 place-items-center rounded-full bg-white">
                <ChainLogo chain={deposit.chain} size={14} className="size-3.5" />
              </span>
            </span>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-4 text-center sm:text-left">
            <div>
              <span className="block text-xs text-muted">{t("sendExactly")}</span>
              {/* The amount and its copy button read as one unit, so they share
                  a row that never wraps the button under the figure. */}
              <div className="mt-1 flex items-center justify-center gap-1.5 sm:justify-start">
                <AssetLogo symbol={deposit.amount.asset} size={22} />
                <strong className="text-xl font-medium tracking-tight whitespace-nowrap tabular-nums">
                  {amount} {deposit.amount.asset}
                </strong>
                <CopyButton
                  copied={copied === "amount"}
                  label={copied === "amount" ? t("amountCopied") : t("copyAmount", { amount })}
                  onClick={() => onCopy("amount", amount)}
                />
              </div>
            </div>
            <div>
              <span className="block text-xs text-muted">{t("network")}</span>
              <span className="mt-1 block text-sm">
                <ChainLabel chain={deposit.chain} size={16} />
              </span>
            </div>
            <p className="m-0 text-xs text-muted">
              {t("onlyAssetCounts", { asset: deposit.amount.asset })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 border-t border-line bg-field/50 px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <span className="block text-xs text-muted">{t("address")}</span>
            <Address value={deposit.address} />
          </div>
          <button
            type="button"
            className="shrink-0 rounded-full border border-line bg-panel px-3.5 py-1.5 text-xs text-ink transition-colors hover:bg-field"
            aria-label={copied === "address" ? t("addressCopied") : t("copyAddress")}
            onClick={() => onCopy("address", deposit.address)}
          >
            {copied === "address" ? t("copied") : t("copy")}
          </button>
        </div>
      </div>

      <div className="mt-6 border-y border-line">
        <Fold
          id={detailsId}
          label={t("paymentDetails")}
          open={detailsOpen}
          onToggle={() => toggle("details")}
        >
          <dl className="m-0 mb-3">
            <DataRow label={t("localPrice")}>{localPrice}</DataRow>
            <DataRow label={t("amountReceivedLabel")}>
              {walletAmount(deposit.received.formatted)} {deposit.received.asset}
            </DataRow>
            <DataRow label={t("referenceId")}>
              <code>{intentId}</code>
            </DataRow>
          </dl>
        </Fold>
        {/* The rules that decide whether a transfer completes this payment.
            Only what the deposit path guarantees: an amount that reaches the
            total funds it (transfers add up), and only this asset on this
            network is ever counted. */}
        <div className="border-t border-line">
          <Fold
            id={notesId}
            label={t("keyThingsToNote")}
            open={notesOpen}
            onToggle={() => toggle("notes")}
          >
            <ul className="m-0 mb-3 flex list-none flex-col gap-2.5 p-0">
              <Note ok>{t("noteSendExact")}</Note>
              <Note ok>{t("noteSentTooLittle")}</Note>
              <Note ok={false}>{t("noteExchangeFee")}</Note>
            </ul>
          </Fold>
        </div>
      </div>
    </>
  );
}

/**
 * The address in full, with its first and last four characters picked out:
 * those are what a payer compares against their wallet's confirmation screen.
 * An EVM `0x` prefix is the same on every address, so the four after it count.
 */
function Address({ value }: { readonly value: string }) {
  const head = value.startsWith("0x") ? 6 : 4;
  if (value.length <= head + 4) return <code className="mt-0.5 block text-ink">{value}</code>;
  return (
    <code className="mt-0.5 block text-muted">
      <span className="text-ink">{value.slice(0, head)}</span>
      {value.slice(head, -4)}
      <span className="text-ink">{value.slice(-4)}</span>
    </code>
  );
}

function CopyButton({
  copied,
  label,
  onClick,
}: {
  readonly copied: boolean;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="grid size-7 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-field hover:text-ink"
      // Icon-only, so the label carries the whole message — including the
      // confirmation, which a sighted payer reads from the check glyph.
      aria-label={label}
      onClick={onClick}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" className="block size-3.5">
        {copied ? (
          <path
            d="M2.5 8.5 L6.5 12.5 L13.5 3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="square"
          />
        ) : (
          <>
            <rect
              x="6"
              y="6"
              width="7.5"
              height="7.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
            />
            <path d="M10 6 V2.5 H2.5 V10 H6" fill="none" stroke="currentColor" strokeWidth="1.4" />
          </>
        )}
      </svg>
    </button>
  );
}

/** A section that folds open under a hairline, with no box around it. */
function Fold({
  id,
  label,
  open,
  onToggle,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly children: ReactNode;
}) {
  return (
    <>
      <button
        type="button"
        className="flex min-h-12 w-full items-center justify-between gap-4 border-0 bg-transparent px-0 py-2.5 text-left text-sm text-ink transition-colors hover:text-muted"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
      >
        <span>{label}</span>
        <span className={`${chevron} ${open ? "-rotate-135" : "rotate-45"}`} aria-hidden="true" />
      </button>
      <div
        id={id}
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="min-h-0 overflow-hidden">{children}</div>
      </div>
    </>
  );
}

function DataRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="grid grid-cols-[5.75rem_minmax(0,1fr)] gap-2.5 py-2 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="m-0 text-right text-xs tabular-nums">{children}</dd>
    </div>
  );
}

/** A rule to follow (tick) or a mistake to avoid (cross). */
function Note({ ok, children }: { readonly ok: boolean; readonly children: ReactNode }) {
  return (
    <li className="relative pl-7 text-xs leading-relaxed text-muted">
      <span
        aria-hidden="true"
        className={`absolute top-0.5 left-0 flex size-4 items-center justify-center rounded-full text-[10px] font-bold text-panel ${
          ok ? "bg-brand" : "bg-danger"
        }`}
      >
        {ok ? "✓" : "✕"}
      </span>
      {children}
    </li>
  );
}
