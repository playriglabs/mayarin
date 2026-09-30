/**
 * Renders a payment document (#293) as a one-page PDF.
 *
 * `pdf-lib` with the standard Helvetica faces: pure JS, no headless browser, no
 * font file to ship. The cost is the WinAnsi character set, so text outside it
 * is replaced before it is drawn rather than failing the whole render over one
 * merchant name.
 */

import { chainLabel, shortHash } from "@mayarin/chain";
import type { PaymentDocument } from "@mayarin/documents";
import { formatMoneyLocale, type Money } from "@mayarin/shared";
import { PDFDocument, type PDFFont, type PDFPage, PDFString, rgb, StandardFonts } from "pdf-lib";

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const RIGHT = PAGE_WIDTH - MARGIN;
const INK = rgb(0.07, 0.07, 0.09);
const MUTED = rgb(0.42, 0.44, 0.5);
const RULE = rgb(0.85, 0.86, 0.88);
const LINK = rgb(0.31, 0.27, 0.9);

/** Human-form money, the way an English document writes it. */
function amount(value: Money): string {
  return formatMoneyLocale(value, { locale: "en-US", trimTrailingZeros: true });
}

function date(value: Date): string {
  return value.toLocaleDateString("en-US", { dateStyle: "long", timeZone: "UTC" });
}

/** Keeps printable Latin-1, the euro sign and the ellipsis; anything Helvetica cannot encode becomes `?`. */
function printable(text: string): string {
  return text.replace(/[^\x20-\x7e\xa0-\xff€…]/g, "?");
}

interface Pen {
  readonly page: PDFPage;
  readonly regular: PDFFont;
  readonly bold: PDFFont;
}

interface TextStyle {
  readonly size?: number;
  readonly bold?: boolean;
  readonly color?: ReturnType<typeof rgb>;
  /** Right-align the text so it ends at `x`. */
  readonly alignRight?: boolean;
}

function text(pen: Pen, value: string, x: number, y: number, style: TextStyle = {}): void {
  const font = style.bold === true ? pen.bold : pen.regular;
  const size = style.size ?? 10;
  const safe = printable(value);
  const left = style.alignRight === true ? x - font.widthOfTextAtSize(safe, size) : x;
  pen.page.drawText(safe, { x: left, y, size, font, color: style.color ?? INK });
}

function rule(pen: Pen, y: number, thickness = 0.5, color = RULE): void {
  pen.page.drawLine({
    start: { x: MARGIN, y },
    end: { x: RIGHT, y },
    thickness,
    color,
  });
}

/** Two-column `label  value` rows; returns the y below the last row. */
function pairs(pen: Pen, rows: readonly (readonly [string, string])[], y: number): number {
  let cursor = y;
  for (const [label, value] of rows) {
    text(pen, label, MARGIN, cursor, { bold: true });
    text(pen, value, MARGIN + 110, cursor);
    cursor -= 15;
  }
  return cursor;
}

function party(pen: Pen, heading: string, lines: readonly string[], x: number, y: number): number {
  text(pen, heading, x, y, { bold: true });
  let cursor = y - 16;
  for (const line of lines) {
    text(pen, line, x, cursor);
    cursor -= 14;
  }
  return cursor;
}

/** A table whose first column is left-aligned and the rest right-aligned at `stops`. */
function table(
  pen: Pen,
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  stops: readonly number[],
  y: number,
): number {
  headers.forEach((header, index) => {
    const stop = stops[index - 1];
    if (index === 0 || stop === undefined) text(pen, header, MARGIN, y, { size: 9, color: MUTED });
    else text(pen, header, stop, y, { size: 9, color: MUTED, alignRight: true });
  });
  rule(pen, y - 6, 1, INK);

  let cursor = y - 22;
  for (const row of rows) {
    row.forEach((cell, index) => {
      const stop = stops[index - 1];
      if (index === 0 || stop === undefined) text(pen, cell, MARGIN, cursor);
      else text(pen, cell, stop, cursor, { alignRight: true });
    });
    cursor -= 18;
  }
  return cursor;
}

function totals(
  pen: Pen,
  rows: readonly (readonly [string, string, boolean])[],
  y: number,
): number {
  const left = PAGE_WIDTH / 2 + 20;
  let cursor = y;
  for (const [label, value, strong] of rows) {
    pen.page.drawLine({
      start: { x: left, y: cursor + 12 },
      end: { x: RIGHT, y: cursor + 12 },
      thickness: 0.5,
      color: RULE,
    });
    text(pen, label, left, cursor, { bold: strong });
    text(pen, value, RIGHT, cursor, { bold: strong, alignRight: true });
    cursor -= 18;
  }
  return cursor;
}

function rateText(rate: NonNullable<NonNullable<PaymentDocument["payment"]>["rate"]>): string {
  return `1 ${rate.from} = ${amount(rate.per)}`;
}

/**
 * Draws a link, right-aligned so it ends at `x`, and makes it clickable: a URI
 * annotation over the text's own box, so the reader clicks the words rather
 * than copying a URL printed underneath them.
 */
function link(pdf: PDFDocument, pen: Pen, label: string, url: string, x: number, y: number): void {
  const size = 10;
  const width = pen.regular.widthOfTextAtSize(label, size);
  text(pen, label, x, y, { color: LINK, alignRight: true });
  const annotation = pdf.context.register(
    pdf.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [x - width, y - 3, x, y + size],
      Border: [0, 0, 0],
      A: { Type: "Action", S: "URI", URI: PDFString.of(url) },
    }),
  );
  pen.page.node.addAnnot(annotation);
}

function paymentRows(doc: PaymentDocument): readonly (readonly [string, string])[] {
  const proof = doc.payment;
  if (proof === undefined) return [];
  const rows: (readonly [string, string])[] = [];
  if (proof.paidWith !== undefined) rows.push(["Paid with", amount(proof.paidWith)]);
  if (proof.network !== undefined) rows.push(["Network", chainLabel(proof.network)]);
  if (proof.rate !== undefined) rows.push(["Rate", rateText(proof.rate)]);
  if (proof.settled !== undefined) rows.push(["Settled", amount(proof.settled)]);
  if (proof.fee !== undefined) rows.push(["Fee", amount(proof.fee)]);
  if (proof.net !== undefined) rows.push(["Merchant received", amount(proof.net)]);
  if (proof.transactionHash !== undefined) {
    rows.push(["Transaction", shortHash(proof.transactionHash)]);
  }
  return rows;
}

export async function renderDocumentPdf(doc: PaymentDocument): Promise<Uint8Array<ArrayBuffer>> {
  const pdf = await PDFDocument.create();
  const isReceipt = doc.kind === "receipt";
  pdf.setTitle(`${isReceipt ? "Receipt" : "Invoice"} ${doc.invoiceNumber}`);
  pdf.setProducer("Mayarin");
  pdf.setCreationDate(doc.paidAt ?? doc.issuedAt);

  const pen: Pen = {
    page: pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };

  let y = PAGE_HEIGHT - MARGIN - 20;
  text(pen, isReceipt ? "Receipt" : "Invoice", MARGIN, y, { size: 24, bold: true });
  y -= 36;

  y = pairs(
    pen,
    [
      ["Invoice number", doc.invoiceNumber],
      ...(doc.receiptNumber === undefined ? [] : [["Receipt number", doc.receiptNumber] as const]),
      ...(doc.paidAt === undefined
        ? [["Date of issue", date(doc.issuedAt)] as const]
        : [["Date paid", date(doc.paidAt)] as const]),
      ...(doc.dueAt === undefined ? [] : [["Date due", date(doc.dueAt)] as const]),
    ],
    y,
  );
  y -= 20;

  const sellerBottom = party(pen, doc.seller.name, doc.seller.lines, MARGIN, y);
  const buyerBottom =
    doc.billTo === undefined
      ? y
      : party(pen, "Bill to", [doc.billTo.name, ...doc.billTo.lines], PAGE_WIDTH / 2, y);
  y = Math.min(sellerBottom, buyerBottom) - 24;

  const headline =
    isReceipt && doc.paidAt !== undefined
      ? `${amount(doc.total)} paid on ${date(doc.paidAt)}`
      : `${amount(doc.total)}${doc.dueAt === undefined ? "" : ` due ${date(doc.dueAt)}`}`;
  text(pen, headline, MARGIN, y, { size: 16, bold: true });
  y -= 22;
  if (doc.memo !== undefined) {
    text(pen, doc.memo, MARGIN, y, { color: MUTED });
    y -= 18;
  }
  y -= 16;

  y = table(
    pen,
    ["Description", "Qty", "Unit price", "Amount"],
    doc.lines.map((line) => [
      line.description,
      String(line.quantity),
      amount(line.unitPrice),
      amount(line.amount),
    ]),
    [360, 450, RIGHT],
    y,
  );
  y -= 8;

  y = totals(
    pen,
    [
      ["Subtotal", amount(doc.total), false],
      ["Total", amount(doc.total), false],
      [isReceipt ? "Amount paid" : "Amount due", amount(doc.total), true],
    ],
    y,
  );

  const rows = paymentRows(doc);
  if (rows.length > 0) {
    y -= 30;
    text(pen, "Payment", MARGIN, y, { size: 16, bold: true });
    y -= 12;
    rule(pen, y, 1, INK);
    y -= 18;
    y = pairs(pen, rows, y);
    // On the Transaction row itself — the last one `pairs` drew, a row above `y`.
    const url = doc.payment?.explorerUrl;
    if (url !== undefined && doc.payment?.transactionHash !== undefined) {
      link(pdf, pen, "View on explorer", url, RIGHT, y + 15);
    }
  }

  text(pen, `Payment ${doc.paymentId} - cleared by Mayarin`, MARGIN, MARGIN - 10, {
    size: 8,
    color: MUTED,
  });

  return new Uint8Array(await pdf.save());
}
