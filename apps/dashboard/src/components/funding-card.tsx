/**
 * How a payment was funded, when a payer paid in their own currency.
 *
 * The payment is still a deposit-match payment — the stablecoin lands at its
 * address like any other — but the merchant opening it should see what the payer
 * actually did: scanned a rupiah QR, paid with GCash. The crypto address and
 * "send exactly" a wallet would show are not what happened here.
 */

import { match } from "ts-pattern";
import { DetailRow } from "@/components/detail-row";
import { PaymentMethodMark } from "@/components/payment-method-mark";
import { Badge } from "@/components/ui/badge";
import type { FundingDto } from "@/types/payment";

/** TransFi's order statuses, in words a merchant would use. */
function stage(status: string): { readonly label: string; readonly tone: "success" | "warning" } {
  return match(status)
    .with("asset_settled", () => ({ label: "Delivered", tone: "success" as const }))
    .with("fund_deposited", () => ({ label: "Paid, delivering", tone: "warning" as const }))
    .otherwise(() => ({ label: "Waiting for the payer", tone: "warning" as const }));
}

function formatFiat(amount: string, currency: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);
  } catch {
    return `${amount} ${currency}`;
  }
}

export function FundingCard({ funding }: { readonly funding: FundingDto }) {
  const state = stage(funding.status);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="m-0 text-sm text-muted-foreground">Paid in local currency</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <PaymentMethodMark
              name={funding.paymentName}
              logoUrl={funding.paymentLogoUrl}
              size={20}
            />
            <span className="text-xl font-medium text-foreground tabular-nums">
              {formatFiat(funding.fiatAmount, funding.fiatCurrency)}
            </span>
          </div>
        </div>
        <Badge variant={state.tone}>{state.label}</Badge>
      </div>
      <dl className="flex flex-col">
        <DetailRow label="Provider">
          {funding.provider === "transfi" ? "TransFi" : funding.provider}
        </DetailRow>
        <DetailRow label="Order">
          <span className="break-all font-mono text-xs">{funding.orderId}</span>
        </DetailRow>
      </dl>
      <p className="m-0 text-xs text-muted-foreground">
        The payer paid in their own currency; the stablecoin is delivered to this payment's address
        and settled to you from there.
      </p>
    </div>
  );
}
