/**
 * Reads a payout file: one recipient per line, `address,amount,asset[,note]`.
 *
 * Every line is checked and every problem is reported with its line number,
 * rather than stopping at the first: a merchant fixing a 60-row file wants the
 * whole list of what is wrong, not one error per upload.
 *
 * Amounts are decimal strings in the asset's whole units (`12.50`), read
 * exactly through `fromDecimalString` — never through a float.
 */

import { type AssetCode, fromDecimalString, isAssetCode, isMayarinError } from "@mayarin/shared";
import type { ParsedPayouts, PayoutRow, PayoutRowError } from "./types.ts";

/**
 * Rows per batch. One transaction carries them all, and a batch that exceeds the
 * block's gas pays for the attempt and moves nothing — a bound far below that is
 * the difference between a refusal here and a failure on chain.
 */
export const MAX_PAYOUT_ROWS = 100;

const ADDRESS = /^0x[\da-fA-F]{40}$/;

export interface ParseOptions {
  /** The assets this Safe can pay out on this chain; anything else is refused. */
  readonly assets: readonly AssetCode[];
}

export function parsePayouts(text: string, options: ParseOptions): ParsedPayouts {
  const lines = text.split(/\r?\n/).map((raw, index) => ({ raw: raw.trim(), line: index + 1 }));
  const content = lines.filter(({ raw }, index) => raw !== "" && !(index === 0 && isHeader(raw)));

  const results = content.map(({ raw, line }) => parseLine(raw, line, options));
  const rows = results.flatMap((result) => ("row" in result ? [result.row] : []));
  const errors = results.flatMap((result) => ("error" in result ? [result.error] : []));

  if (rows.length === 0 && errors.length === 0) {
    return { rows, errors: [{ line: 1, message: "The file has no payouts" }] };
  }
  if (rows.length > MAX_PAYOUT_ROWS) {
    return {
      rows,
      errors: [
        ...errors,
        { line: 1, message: `A batch can pay at most ${MAX_PAYOUT_ROWS} recipients` },
      ],
    };
  }
  return { rows, errors };
}

function isHeader(raw: string): boolean {
  return raw.toLowerCase().startsWith("address");
}

type LineResult = { readonly row: PayoutRow } | { readonly error: PayoutRowError };

function parseLine(raw: string, line: number, options: ParseOptions): LineResult {
  const cells = raw.split(",");
  const [address = "", amount = "", asset = ""] = cells.map((cell) => cell.trim());
  // Everything after the third comma, verbatim: a note may itself contain commas.
  const note = cells.slice(3).join(",").trim();
  const fail = (message: string): LineResult => ({ error: { line, message } });

  if (!ADDRESS.test(address)) return fail(`"${address}" is not an address`);
  if (/^0x0{40}$/.test(address)) return fail("Paying the zero address burns the money");

  const code = asset.toUpperCase();
  if (!isAssetCode(code) || !options.assets.includes(code)) {
    return fail(`${asset === "" ? "The asset" : `"${asset}"`} is not payable from this wallet`);
  }

  let value: ReturnType<typeof fromDecimalString>;
  try {
    value = fromDecimalString(amount, code);
  } catch (error) {
    if (isMayarinError(error)) return fail(`"${amount}" is not a ${code} amount`);
    throw error;
  }
  if (value.amount <= 0n) return fail("An amount must be more than zero");

  return {
    row: {
      line,
      to: address.toLowerCase(),
      amount: value,
      ...(note === "" ? {} : { note }),
    },
  };
}
