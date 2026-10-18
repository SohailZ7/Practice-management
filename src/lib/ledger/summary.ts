export type SummaryRow = { date: string; cashIn: number; cashOut: number; categoryId: string | null };

export type Bucket = { key: string; cashIn: number; cashOut: number; net: number; count: number };

function bucketize(rows: SummaryRow[], keyOf: (r: SummaryRow) => string): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const r of rows) {
    const key = keyOf(r);
    const b = map.get(key) ?? { key, cashIn: 0, cashOut: 0, net: 0, count: 0 };
    b.cashIn += r.cashIn;
    b.cashOut += r.cashOut;
    b.net = b.cashIn - b.cashOut;
    b.count += 1;
    map.set(key, b);
  }
  return [...map.values()];
}

/** Totals per category (key = category id, or "" for none), biggest spend first. */
export const byCategory = (rows: SummaryRow[]) =>
  bucketize(rows, (r) => r.categoryId ?? "").sort((a, b) => b.cashOut - a.cashOut || b.cashIn - a.cashIn);

/** Totals per month (key = YYYY-MM), oldest first. */
export const byMonth = (rows: SummaryRow[]) => bucketize(rows, (r) => r.date.slice(0, 7)).sort((a, b) => a.key.localeCompare(b.key));
