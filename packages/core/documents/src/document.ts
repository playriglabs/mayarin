/**
 * Builds the invoice and receipt for one payment.
 *
 * Pure: every input is a snapshot the caller already loaded, and the output is
 * a value a renderer prints. Where a source is missing — a payment with no cart,
 * no invoice, no known payer — the document says less rather than guessing.
 */

import { type CartSnapshot, type Customer, parseCartSnapshot } from "@mayarin/catalog";
import { transactionExplorerUrl } from "@mayarin/chain";
import type { ClearingTransaction } from "@mayarin/clearing";
import { INVOICE_METADATA_KEY, type Invoice, type InvoiceLine } from "@mayarin/invoicing";
import type { PaymentIntent } from "@mayarin/payment-intent";
import { assetDecimals, ConflictError, type Money, money } from "@mayarin/shared";
import type {
  DocumentLine,
  DocumentParty,
  DocumentRate,
  PaymentDocument,
  PaymentProof,
} from "./types.ts";

export interface DocumentSources {
  readonly intent: PaymentIntent;
  readonly transaction: ClearingTransaction | null;
  /** The invoice the intent was minted from, when `metadata.invoiceId` names one. */
  readonly invoice?: Invoice;
  /** The customer `metadata.customerId` names, when there is one. */
  readonly customer?: Customer;
  /** The payer's funding transfer on the deposit-match path. */
  readonly fundingTxHash?: string;
}

const TX_HASH = /^0x[\da-f]{64}$/i;

/** The invoice id an intent carries, when it was minted from one. */
export function invoiceIdOf(intent: PaymentIntent): string | undefined {
  return intent.metadata[INVOICE_METADATA_KEY];
}

/**
 * A short, stable number derived from an id: the last eight characters of its
 * random half, split in two. A link or cart payment has no invoice series to
 * belong to, and deriving the number means there is no allocator to agree with.
 */
export function derivedNumber(id: string): string {
  const tail = id.slice(-8).toUpperCase();
  return `${tail.slice(0, 4)}-${tail.slice(4)}`;
}

export function invoiceDocument(sources: DocumentSources): PaymentDocument {
  const { intent, invoice } = sources;
  const billTo = billToOf(sources);
  const memo = memoOf(sources);
  const lines = linesOf(sources);
  return {
    kind: "invoice",
    paymentId: intent.id,
    invoiceNumber: invoice?.number ?? derivedNumber(intent.id),
    issuedAt: invoice?.issuedAt ?? intent.createdAt,
    dueAt: invoice?.dueAt ?? intent.expiresAt,
    seller: sellerOf(intent),
    ...(billTo === undefined ? {} : { billTo }),
    ...(memo === undefined ? {} : { memo }),
    lines,
    total: intent.amount,
  };
}

/** A receipt exists only for a completed payment: it is the record that it was paid. */
export function receiptDocument(sources: DocumentSources): PaymentDocument {
  const { intent, transaction } = sources;
  if (intent.status !== "COMPLETED") {
    throw new ConflictError("A receipt is available once the payment has completed", {
      id: intent.id,
      status: intent.status,
    });
  }
  const invoice = invoiceDocument(sources);
  const { dueAt: _dueAt, ...rest } = invoice;
  return {
    ...rest,
    kind: "receipt",
    receiptNumber: derivedNumber(transaction?.id ?? intent.id),
    paidAt: intent.completedAt ?? intent.updatedAt,
    payment: proofOf(sources),
  };
}

/**
 * The transaction that moved the money, as far as clearing itself recorded it:
 * the contract-path submission, else an x402 settlement reference. A reference
 * that is not a transaction hash — an off-chain adapter's own id — is not one.
 */
export function settlementHashOf(transaction: ClearingTransaction): string | undefined {
  const reference = transaction.providerReference;
  return (
    transaction.contract?.txHash ??
    (reference !== undefined && TX_HASH.test(reference) ? reference : undefined)
  );
}

function sellerOf(intent: PaymentIntent): DocumentParty {
  const { name, city, countryCode } = intent.merchant;
  return { name, lines: [city, countryCode].filter((line) => line !== "") };
}

function billToOf({ intent, invoice, customer }: DocumentSources): DocumentParty | undefined {
  if (invoice !== undefined) {
    const { name, address, email, taxId } = invoice.buyer;
    return {
      name,
      lines: [
        ...(address === undefined ? [] : address.split("\n")),
        ...(email === undefined ? [] : [email]),
        ...(taxId === undefined ? [] : [`Tax ID ${taxId}`]),
      ],
    };
  }
  if (customer !== undefined) {
    return { name: customer.name, lines: customer.email === undefined ? [] : [customer.email] };
  }
  const payer = intent.payment?.payerAddress;
  return payer === undefined ? undefined : { name: "Payer", lines: [payer] };
}

function memoOf({ intent, invoice }: DocumentSources): string | undefined {
  if (invoice?.notes !== undefined) return invoice.notes;
  return intent.merchantReference === undefined
    ? undefined
    : `Reference ${intent.merchantReference}`;
}

function linesOf({ intent, invoice }: DocumentSources): readonly DocumentLine[] {
  if (invoice !== undefined) return invoice.lines.map(fromInvoiceLine);

  const raw = intent.metadata.cart;
  const cart = raw === undefined ? undefined : parseCartSnapshot(raw);
  if (cart !== undefined && cart.currency === intent.amount.asset) return fromCart(cart);

  return [
    {
      description: `Payment to ${intent.merchant.name}`,
      quantity: 1,
      unitPrice: intent.amount,
      amount: intent.amount,
    },
  ];
}

function fromInvoiceLine(line: InvoiceLine): DocumentLine {
  return {
    description: line.name,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    amount: times(line.unitPrice, line.quantity),
  };
}

function fromCart(cart: CartSnapshot): readonly DocumentLine[] {
  return cart.lines.map((line) => {
    const unitPrice = money(BigInt(line.unitPrice), cart.currency);
    return {
      description: line.name,
      quantity: line.quantity,
      unitPrice,
      amount: times(unitPrice, line.quantity),
    };
  });
}

function times(value: Money, quantity: number): Money {
  return money(value.amount * BigInt(quantity), value.asset);
}

/**
 * What one whole unit of the merchant's currency cleared for, from the two
 * amounts clearing froze. Absent before a price lock, and when the merchant
 * priced in the settlement asset itself — "1 USDG = 1 USDG" says nothing.
 */
export function clearedRate(transaction: ClearingTransaction): DocumentRate | undefined {
  const source = transaction.sourceAmount;
  const settled = transaction.settlementAmount;
  if (settled === undefined || source.amount <= 0n || source.asset === settled.asset) {
    return undefined;
  }
  const numerator = settled.amount * 10n ** BigInt(assetDecimals(source.asset));
  // Half-up: this is a figure for a reader, and nearest is the honest one.
  const per = (numerator * 2n + source.amount) / (source.amount * 2n);
  return { from: source.asset, per: money(per, settled.asset) };
}

function proofOf({ intent, transaction, fundingTxHash }: DocumentSources): PaymentProof {
  if (transaction === null) return {};

  const paidWith = transaction.deposit?.amount ?? transaction.contract?.payerEstimate;
  const network = transaction.deposit?.chain ?? intent.payment?.chain;
  const net = transaction.onChain?.settledAmount ?? transaction.netAmount;
  const transactionHash = settlementHashOf(transaction) ?? fundingTxHash;
  const explorerUrl =
    network === undefined || transactionHash === undefined
      ? undefined
      : transactionExplorerUrl(network, transactionHash);
  const rate = clearedRate(transaction);

  return {
    ...(paidWith === undefined ? {} : { paidWith }),
    ...(network === undefined ? {} : { network }),
    ...(rate === undefined ? {} : { rate }),
    ...(transaction.settlementAmount === undefined
      ? {}
      : { settled: transaction.settlementAmount }),
    ...(transaction.fee === undefined ? {} : { fee: transaction.fee }),
    ...(net === undefined ? {} : { net }),
    ...(transactionHash === undefined ? {} : { transactionHash }),
    ...(explorerUrl === undefined ? {} : { explorerUrl }),
  };
}
