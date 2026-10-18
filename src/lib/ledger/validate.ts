import { isISODate } from "../dates";
import { MAX_CENTS } from "./money";

export type LedgerInput = {
  date: string;
  cashIn: number;
  cashOut: number;
  partyId?: string | null;
  categoryId?: string | null;
  methodId?: string | null;
  comments?: string;
};

const isCents = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= MAX_CENTS;

/** Returns an error message, or null when the entry is valid. */
export function ledgerEntryError(e: LedgerInput): string | null {
  if (!isISODate(e.date)) return "Enter a real date.";
  if (!isCents(e.cashIn) || !isCents(e.cashOut)) return "Amounts must be between $0 and $999,999,999.99.";
  if (e.cashIn > 0 && e.cashOut > 0) return "Enter either cash in or cash out, not both.";
  if (e.cashIn === 0 && e.cashOut === 0) return "Enter an amount in cash in or cash out.";
  if ((e.comments ?? "").length > 1000) return "Keep comments to 1,000 characters or fewer.";
  return null;
}

export type LedgerTotals = { cashIn: number; cashOut: number; net: number; count: number };

export function ledgerTotals(rows: { cashIn: number; cashOut: number }[]): LedgerTotals {
  const cashIn = rows.reduce((s, r) => s + r.cashIn, 0);
  const cashOut = rows.reduce((s, r) => s + r.cashOut, 0);
  return { cashIn, cashOut, net: cashIn - cashOut, count: rows.length };
}

/** Quotes a CSV field; also defuses spreadsheet formulas (=, +, -, @) in text. */
export function csvField(value: string, isText = true): string {
  let v = value;
  if (isText && /^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
