/**
 * Local payment methods a payer can fund a payment with, by merchant country.
 *
 * From what TransFi lists as deposit methods for these markets. A country absent
 * here has no local rail yet, and the form says nothing rather than promise one.
 */
const LOCAL_RAILS: Readonly<Record<string, readonly string[]>> = {
  PH: ["GCash", "Maya", "QR Ph", "GrabPay"],
  ID: ["QRIS", "DANA", "OVO", "bank transfer"],
  MY: ["FPX", "Touch 'n Go", "Boost"],
  BR: ["Pix"],
  MX: ["SPEI"],
  AU: ["PayID"],
  CA: ["Interac"],
};

export function localRailsFor(countryCode: string): readonly string[] {
  return LOCAL_RAILS[countryCode] ?? [];
}
