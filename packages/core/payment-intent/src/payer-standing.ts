/**
 * Payer standing (#314): whether a wallet may still take buyer protection.
 *
 * A port, because the answer comes from dispute history this package does not
 * store. A flagged wallet keeps every way to pay; it only loses the escrow,
 * which is the thing it was abusing.
 */
export interface PayerStandingSource {
  isFlagged(payer: string): Promise<boolean>;
}
