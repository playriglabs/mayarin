import { chainLabel } from "@mayarin/chain";
import { useT } from "../../i18n/index.tsx";
import { walletAmount } from "../../shared/money.ts";
import { footnote, stateText, stateTitle, stateView } from "../../shared/ui.ts";
import { ProcessingArt } from "./illustrations.tsx";
import type { Deposit } from "./types.ts";

/**
 * The moment the money arrives, the page must stop asking to be paid.
 *
 * This replaces the deposit card — amount, QR, address, copy buttons all
 * leave — because every one of them invites a second transfer. `role="status"`
 * makes the transition audible to a screen reader without stealing focus.
 */
export function ConfirmingCard({
  deposit,
  intentId,
}: {
  readonly deposit: Deposit;
  readonly intentId: string;
}) {
  const t = useT();
  const received = walletAmount(deposit.received.formatted);

  return (
    <div className={stateView} role="status">
      <ProcessingArt />
      <h2 className={stateTitle}>{t("paymentProcessing")}</h2>
      {/* One sentence: what arrived and where, then how long. The amount is
          the payer's proof it landed, so it leads. */}
      <p className={stateText}>
        {deposit.received.amount === "0"
          ? t("assetArrived", { asset: deposit.amount.asset, chain: chainLabel(deposit.chain) })
          : t("amountReceived", {
              amount: received,
              asset: deposit.received.asset,
              chain: chainLabel(deposit.chain),
            })}{" "}
        {t("confirmingNow")}
      </p>
      <p className={`${footnote} mt-6`}>
        {t("referenceId")} <code>{intentId}</code>
      </p>
    </div>
  );
}
