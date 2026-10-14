/**
 * What a payer is told to do to pay an order, in a form a page can draw.
 *
 * TransFi's headless order returns `paymentsData` in a shape that depends on the
 * method: a QR string for QRIS and QR Ph, a virtual-account number for a bank
 * transfer, and for anything it cannot do headless a `redirect` to a homepage
 * that is no use to a payer. Everything it cannot draw — and any type this does
 * not know — becomes `redirect` to the hosted pay page, which handles every
 * method. A new `paymentsData` type therefore degrades to a working page, never
 * to a blank one.
 */

export type PaymentInstructions =
  | { readonly kind: "qr"; readonly value: string }
  | { readonly kind: "va"; readonly code: string; readonly bank: string | null }
  | { readonly kind: "redirect"; readonly url: string };

export interface PaymentsData {
  readonly type?: string | undefined;
  readonly qrCode?: string | undefined;
  readonly vaCode?: string | undefined;
  readonly extra?: { readonly vaBank?: string | undefined } | undefined;
}

export function instructionsOf(
  payUrl: string,
  data: PaymentsData | undefined,
): PaymentInstructions {
  if (data?.type === "qrCode" && data.qrCode !== undefined && data.qrCode !== "") {
    return { kind: "qr", value: data.qrCode };
  }
  if (data?.type === "vaCode" && data.vaCode !== undefined && data.vaCode !== "") {
    return { kind: "va", code: data.vaCode, bank: data.extra?.vaBank ?? null };
  }
  return { kind: "redirect", url: payUrl };
}
