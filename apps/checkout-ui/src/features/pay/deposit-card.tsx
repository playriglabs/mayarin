import { AssetLogo } from "../../shared/asset-logo.tsx";
import { ChainLabel } from "../../shared/chain-logo.tsx";
import { walletAmount } from "../../shared/money.ts";
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
  const amount = walletAmount(deposit.amount.formatted);

  return (
    <>
      <div className="send-amount">
        <span>Send this exact amount</span>
        {/* The amount and its copy button read as one unit, so they share a
            row rather than the button spanning the card. */}
        <div className="amount-row">
          <strong>
            <AssetLogo symbol={deposit.amount.asset} size={30} />
            {amount} {deposit.amount.asset}
          </strong>
          <button
            type="button"
            className="copy copy-inline"
            // Icon-only, so the label carries the whole message — including the
            // confirmation, which a sighted payer reads from the check glyph.
            aria-label={copied === "amount" ? "Amount copied" : `Copy the amount ${amount}`}
            onClick={() => onCopy("amount", amount)}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              {copied === "amount" ? (
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
                  <path
                    d="M10 6 V2.5 H2.5 V10 H6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                  />
                </>
              )}
            </svg>
          </button>
        </div>
      </div>
      {deposit.uri !== null && (
        <div className="qr">
          <img
            alt={`QR payment ${deposit.amount.asset} at ${deposit.chain}`}
            src={`/checkout/qr?value=${encodeURIComponent(deposit.uri)}`}
          />
        </div>
      )}
      <dl className="payment-data">
        <div>
          <dt>Local price</dt>
          <dd>{localPrice}</dd>
        </div>
        <div>
          <dt>Asset</dt>
          <dd className="asset-value">
            <AssetLogo symbol={deposit.amount.asset} size={18} />
            {deposit.amount.asset}
          </dd>
        </div>
        <div>
          <dt>Network</dt>
          <dd>
            <ChainLabel chain={deposit.chain} />
          </dd>
        </div>
        <div className="address-row">
          <dt>Address</dt>
          <dd>
            <code>{deposit.address}</code>
          </dd>
        </div>
        <div>
          <dt>Amount received</dt>
          <dd>
            {walletAmount(deposit.received.formatted)} {deposit.received.asset}
          </dd>
        </div>
        <div>
          <dt>Reference ID</dt>
          <dd>
            <code>{intentId}</code>
          </dd>
        </div>
      </dl>
      <button
        type="button"
        className="copy"
        aria-label="Copy the payment address"
        onClick={() => onCopy("address", deposit.address)}
      >
        {copied === "address" ? "Address copied" : "Copy payment address"}
      </button>
      <p className="estimate-note">
        Send only {deposit.amount.asset} on <ChainLabel chain={deposit.chain} size={18} />. A
        smaller amount or an asset on another network will not complete this payment.
      </p>
    </>
  );
}
