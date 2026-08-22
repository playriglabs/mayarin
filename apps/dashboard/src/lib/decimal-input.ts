/**
 * Parses an editable decimal amount at the UI boundary.
 *
 * Keyboards follow the user's locale: some emit a dot and some a comma. The
 * shared money parser stays machine-strict, so the dashboard normalizes the
 * one decimal separator before handing the value to it. Grouping is not
 * accepted because `1.000` cannot safely mean both one and one thousand.
 */

import type { AssetCode } from "@mayarin/shared/asset";
import { fromDecimalString, type Money } from "@mayarin/shared/money";

export function fromEditableDecimalString(value: string, asset: AssetCode): Money {
  return fromDecimalString(value.trim().replace(",", "."), asset);
}
